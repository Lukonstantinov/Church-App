import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import {
  createMeetingSchema,
  createScheduleSchema,
  saveRollSchema,
  updateMeetingSchema,
  updateScheduleSchema,
  zonedToUtc,
  type MeetingRow,
  type MyAttendanceResponse,
  type RollResponse,
  type ScheduleRow,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import {
  attendance,
  meetingSchedules,
  meetings,
  memberships,
  groups,
  type MeetingSchedule,
} from '../db/schema';
import { assertCan, can } from '../lib/access';
import { audit } from '../lib/audit';
import { getChurch } from '../lib/church';
import {
  editWindow,
  generateMeetings,
  groupStats,
  memberAttendance,
  rosterFor,
  toMeetingRows,
} from '../lib/meetings';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

const toScheduleRow = (s: MeetingSchedule): ScheduleRow => ({
  id: s.id,
  groupId: s.groupId,
  weekday: s.weekday,
  startTime: s.startTime,
  durationMin: s.durationMin,
  title: s.title,
  active: s.active,
});

// ---------- /api/groups/:id/{schedules,meetings,stats} ----------

export const groupMeetingRoutes = new Hono<App>();

groupMeetingRoutes.get('/:id/schedules', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'meetings.manage');
  const rows = await db
    .select()
    .from(meetingSchedules)
    .where(eq(meetingSchedules.groupId, group.id))
    .orderBy(asc(meetingSchedules.weekday), asc(meetingSchedules.startTime));
  return c.json(rows.map(toScheduleRow));
});

groupMeetingRoutes.post('/:id/schedules', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'meetings.manage');
  const input = await parseBody(c, createScheduleSchema);
  const [row] = await db
    .insert(meetingSchedules)
    .values({ groupId: group.id, ...input })
    .returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'schedule_created',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: input,
  });
  // Make the upcoming meetings visible right away instead of waiting for the hourly job.
  await generateMeetings(db, (await getChurch(db)).timezone, { groupId: group.id });
  return c.json(toScheduleRow(row!), 201);
});

groupMeetingRoutes.get('/:id/stats', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'any');
  return c.json(await groupStats(db, group.id));
});

/**
 * ?scope=upcoming (default): meetings that haven't ended, soonest first.
 * ?scope=past: meetings that have ended, newest first; page with ?before=<startsAt>.
 */
groupMeetingRoutes.get('/:id/meetings', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'any');
  const now = new Date().toISOString();
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 30, 1), 100);
  const list =
    c.req.query('scope') === 'past'
      ? await db
          .select()
          .from(meetings)
          .where(
            and(
              eq(meetings.groupId, group.id),
              lt(meetings.endsAt, now),
              c.req.query('before') ? lt(meetings.startsAt, c.req.query('before')!) : undefined,
            ),
          )
          .orderBy(desc(meetings.startsAt))
          .limit(limit)
      : await db
          .select()
          .from(meetings)
          .where(and(eq(meetings.groupId, group.id), gte(meetings.endsAt, now)))
          .orderBy(asc(meetings.startsAt))
          .limit(limit);
  return c.json(await toMeetingRows(db, list));
});

/** One-off meeting (event, camp, a missed date being recorded after the fact). */
groupMeetingRoutes.post('/:id/meetings', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'meetings.manage');
  const input = await parseBody(c, createMeetingSchema);
  const { timezone } = await getChurch(db);
  const startsAt = zonedToUtc(input.date, input.startTime, timezone);
  if (Number.isNaN(startsAt.getTime()))
    throw new HTTPException(400, { message: 'validation_error' });
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  const [row] = await db
    .insert(meetings)
    .values({
      groupId: group.id,
      title: input.title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    })
    .returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'meeting_created',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: { meetingId: row!.id },
  });
  return c.json((await toMeetingRows(db, [row!]))[0], 201);
});

// ---------- /api/schedules ----------

export const scheduleRoutes = new Hono<App>();

async function loadSchedule(c: { get: (k: 'db') => AuthVariables['db'] }, id: number) {
  const db = c.get('db');
  const row = await db.query.meetingSchedules.findFirst({ where: eq(meetingSchedules.id, id) });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  return row;
}

scheduleRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const schedule = await loadSchedule(c, idParam(c));
  await assertCan(db, user, schedule.groupId, 'meetings.manage');
  const input = await parseBody(c, updateScheduleSchema);
  const [row] = await db
    .update(meetingSchedules)
    .set(input)
    .where(eq(meetingSchedules.id, schedule.id))
    .returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'schedule_updated',
    entity: 'group',
    entityId: schedule.groupId,
    groupId: schedule.groupId,
    data: input,
  });

  // Future meetings that nobody has touched follow the schedule: rebuild them when the
  // timing changes or the schedule is switched off; just rename them for a title edit.
  const futureEmpty = and(
    eq(meetings.scheduleId, schedule.id),
    eq(meetings.status, 'scheduled'),
    gte(meetings.startsAt, new Date().toISOString()),
  );
  const timingChanged =
    input.weekday !== undefined || input.startTime !== undefined || input.durationMin !== undefined;
  if (timingChanged || input.active === false) {
    await db.delete(meetings).where(futureEmpty);
  } else if (input.title !== undefined) {
    await db.update(meetings).set({ title: input.title }).where(futureEmpty);
  }
  if (row!.active)
    await generateMeetings(db, (await getChurch(db)).timezone, { groupId: schedule.groupId });
  return c.json(toScheduleRow(row!));
});

/** Removes a schedule and its future, still-empty meetings; past meetings keep their history. */
scheduleRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const schedule = await loadSchedule(c, idParam(c));
  await assertCan(db, user, schedule.groupId, 'meetings.manage');
  await db
    .delete(meetings)
    .where(
      and(
        eq(meetings.scheduleId, schedule.id),
        eq(meetings.status, 'scheduled'),
        gte(meetings.startsAt, new Date().toISOString()),
      ),
    );
  // Keep the row (past meetings reference it) but switch it off.
  await db
    .update(meetingSchedules)
    .set({ active: false })
    .where(eq(meetingSchedules.id, schedule.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'schedule_removed',
    entity: 'group',
    entityId: schedule.groupId,
    groupId: schedule.groupId,
    data: { scheduleId: schedule.id },
  });
  return c.json({ ok: true });
});

// ---------- /api/meetings ----------

export const meetingRoutes = new Hono<App>();

meetingRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting || !(await can(db, user, meeting.groupId, 'meetings.manage'))) {
    throw new HTTPException(404, { message: 'not_found' });
  }
  const input = await parseBody(c, updateMeetingSchema);
  if (input.status === 'cancelled' && meeting.status === 'done') {
    throw new HTTPException(409, { message: 'has_roll_call' });
  }
  const patch: Partial<typeof meetings.$inferInsert> = {};
  if (input.status !== undefined && meeting.status !== 'done') patch.status = input.status;
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length > 0) {
    await db.update(meetings).set(patch).where(eq(meetings.id, meeting.id));
    await audit(db, {
      actorUserId: user.id,
      action: 'meeting_updated',
      entity: 'group',
      entityId: meeting.groupId,
      groupId: meeting.groupId,
      data: { meetingId: meeting.id, ...patch },
    });
  }
  const updated = await db.query.meetings.findFirst({ where: eq(meetings.id, meeting.id) });
  return c.json((await toMeetingRows(db, [updated!]))[0]);
});

async function loadRollMeeting(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting || !(await can(db, user, meeting.groupId, 'attendance.take'))) {
    throw new HTTPException(404, { message: 'not_found' });
  }
  return { db, user, meeting };
}

meetingRoutes.get('/:id/roll', async (c) => {
  const { db, user, meeting } = await loadRollMeeting(c, idParam(c));
  const { timezone } = await getChurch(db);
  const win = editWindow(meeting);
  const body: RollResponse = {
    meeting: (await toMeetingRows(db, [meeting]))[0]!,
    roster: await rosterFor(db, meeting, timezone),
    editable:
      meeting.status !== 'cancelled' && (meeting.status !== 'done' || win.open || user.isAdmin),
    editableUntil: meeting.status === 'done' ? win.editableUntil : null,
  };
  return c.json(body);
});

meetingRoutes.put('/:id/roll', async (c) => {
  const { db, user, meeting } = await loadRollMeeting(c, idParam(c));
  const input = await parseBody(c, saveRollSchema);
  if (meeting.status === 'cancelled') throw new HTTPException(409, { message: 'cancelled' });
  const now = new Date();
  // Rolls open an hour before the start (people arrive early).
  if (new Date(meeting.startsAt).getTime() - now.getTime() > 3_600_000) {
    throw new HTTPException(409, { message: 'not_started' });
  }
  if (meeting.status === 'done' && !editWindow(meeting, now).open && !user.isAdmin) {
    throw new HTTPException(403, { message: 'edit_window_closed' });
  }

  const { timezone } = await getChurch(db);
  const roster = await rosterFor(db, meeting, timezone);
  const allowed = new Set(roster.map((r) => r.userId));
  const chosen = new Map<number, (typeof input.entries)[number]['status']>();
  for (const e of input.entries) {
    if (!allowed.has(e.userId)) throw new HTTPException(400, { message: 'unknown_member' });
    chosen.set(e.userId, e.status);
  }

  const markedAt = now.toISOString();
  const writes = roster.map((r) =>
    db
      .insert(attendance)
      .values({
        meetingId: meeting.id,
        userId: r.userId,
        status: chosen.get(r.userId) ?? 'absent', // unmarked members count as absent
        markedBy: user.id,
        markedAt,
      })
      .onConflictDoUpdate({
        target: [attendance.meetingId, attendance.userId],
        set: { status: chosen.get(r.userId) ?? 'absent', markedBy: user.id, markedAt },
      }),
  );
  const finish = db
    .update(meetings)
    .set({
      status: 'done',
      guestCount: input.guestCount,
      rollTakenBy: user.id,
      rollTakenAt: markedAt,
    })
    .where(eq(meetings.id, meeting.id));
  const statements = [...writes, finish];
  // D1 runs a batch atomically; keep batches modest for big groups.
  for (let i = 0; i < statements.length; i += 90) {
    const chunk = statements.slice(i, i + 90);
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
  }
  await audit(db, {
    actorUserId: user.id,
    action: meeting.status === 'done' ? 'roll_edited' : 'roll_saved',
    entity: 'group',
    entityId: meeting.groupId,
    groupId: meeting.groupId,
    data: { meetingId: meeting.id, guests: input.guestCount, members: roster.length },
  });

  const updated = await db.query.meetings.findFirst({ where: eq(meetings.id, meeting.id) });
  return c.json((await toMeetingRows(db, [updated!]))[0] as MeetingRow);
});

// ---------- /api/me/attendance ----------

export const myAttendanceRoutes = new Hono<App>();

myAttendanceRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const { timezone } = await getChurch(db);
  const rows = await db
    .select({ m: memberships, groupName: groups.name })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active')));
  const result: MyAttendanceResponse = {
    groups: await Promise.all(
      rows.map(({ m, groupName }) =>
        memberAttendance(db, {
          userId: user.id,
          groupId: m.groupId,
          groupName,
          joinedAt: m.joinedAt,
          timezone,
        }),
      ),
    ),
  };
  return c.json(result);
});
