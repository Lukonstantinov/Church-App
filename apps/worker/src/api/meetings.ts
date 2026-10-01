import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import {
  createMeetingSchema,
  createScheduleSchema,
  saveRollSchema,
  notifyMeetingSchema,
  updateMeetingSchema,
  updateScheduleSchema,
  zonedToUtc,
  type MeetingDetail,
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
  meetingAudience,
  transactions,
  users,
  type Meeting,
  type MeetingSchedule,
} from '../db/schema';
import { accessIn, assertCan, can } from '../lib/access';
import { notifyMeetingRole } from '../lib/meetingNotify';
import { drainOutbox } from '../lib/outbox';
import { appUrlFor, botApi } from '../lib/telegram';
import { audit } from '../lib/audit';
import { getChurch } from '../lib/church';
import {
  audienceOf,
  editWindow,
  meetingIsFor,
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
  if (input.audience?.length) await setAudience(db, group.id, row!.id, input.audience);
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
    isNull(meetings.leaderUserId),
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

/** Who may do what with a meeting: managers everything; its leader place/topic/snacks. */
async function meetingAccess(
  db: AuthVariables['db'],
  user: AuthVariables['user'],
  meeting: Meeting,
) {
  const access = await accessIn(db, user, meeting.groupId);
  const manage = access.perms.has('meetings.manage');
  const leads = meeting.leaderUserId === user.id && access.member;
  return {
    member: access.member,
    manage,
    edit: manage || leads,
    roll: access.perms.has('attendance.take'),
    money: access.perms.has('money.view'),
  };
}

async function assertActiveMember(db: AuthVariables['db'], groupId: number, userId: number) {
  const row = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(
      eq(memberships.groupId, groupId),
      eq(memberships.userId, userId),
      eq(memberships.status, 'active'),
    ),
  });
  if (!row) throw new HTTPException(400, { message: 'not_a_member' });
}

/** Replaces who a meeting is for (empty = everyone). Everyone listed must be an active member. */
async function setAudience(
  db: AuthVariables['db'],
  groupId: number,
  meetingId: number,
  userIds: number[],
) {
  const ids = [...new Set(userIds)];
  if (ids.length) {
    const ok = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.groupId, groupId),
          eq(memberships.status, 'active'),
          inArray(memberships.userId, ids),
        ),
      );
    if (ok.length !== ids.length) throw new HTTPException(400, { message: 'not_a_member' });
  }
  await db.delete(meetingAudience).where(eq(meetingAudience.meetingId, meetingId));
  for (const userId of ids) await db.insert(meetingAudience).values({ meetingId, userId });
}

/**
 * One meeting. Members see when, where, the topic and who leads; attendance and
 * expenses only go to people with those rights.
 */
meetingRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  const a = await meetingAccess(db, user, meeting);
  if (!a.member) throw new HTTPException(404, { message: 'not_found' });
  // A meeting for chosen people is hidden from everyone else (managers see all).
  if (!a.edit && !meetingIsFor(await audienceOf(db, [meeting.id]), meeting.id, user.id))
    throw new HTTPException(404, { message: 'not_found' });
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, meeting.groupId) }))!;
  const [row] = await toMeetingRows(db, [meeting]);
  const seeRoll = a.roll || a.edit;
  const detail: MeetingDetail = {
    ...row!,
    counts: seeRoll ? row!.counts : { present: 0, late: 0, excused: 0, absent: 0 },
    guestCount: seeRoll ? row!.guestCount : 0,
    budgetCents: a.money || a.edit ? row!.budgetCents : null,
    groupName: group.name,
    canEdit: a.edit,
    canManage: a.manage,
    attendance: seeRoll
      ? (
          await db
            .select({
              userId: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              status: attendance.status,
            })
            .from(attendance)
            .innerJoin(users, eq(users.id, attendance.userId))
            .where(eq(attendance.meetingId, meeting.id))
            .orderBy(asc(users.firstName))
        ).map((x) => ({
          userId: x.userId,
          firstName: x.firstName,
          lastName: x.lastName,
          present: x.status === 'present' || x.status === 'late',
        }))
      : null,
    expenses:
      a.money || a.edit
        ? (
            await db
              .select({
                id: transactions.id,
                amountCents: transactions.amountCents,
                note: transactions.note,
                category: transactions.category,
                occurredOn: transactions.occurredOn,
                kind: transactions.kind,
                memberId: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
              })
              .from(transactions)
              .leftJoin(users, eq(users.id, transactions.createdBy))
              .where(and(eq(transactions.meetingId, meeting.id), isNull(transactions.voidedAt)))
              .orderBy(asc(transactions.occurredOn))
          )
            .filter((x) => x.kind === 'expense' || x.kind === 'event_expense')
            .map((x) => ({
              id: x.id,
              amountCents: x.amountCents,
              note: x.note,
              category: x.category,
              occurredOn: x.occurredOn,
              member: x.memberId
                ? { id: x.memberId, firstName: x.firstName!, lastName: x.lastName }
                : null,
            }))
        : null,
    defaultBudgetCents: group.meetingBudgetCents,
  };
  return c.json(detail);
});

/** Active members to choose a leader or snack person from (for people who may edit). */
meetingRoutes.get('/:id/people', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  const a = await meetingAccess(db, user, meeting);
  if (!a.edit) throw new HTTPException(a.member ? 403 : 404, { message: 'forbidden' });
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupId, meeting.groupId), eq(memberships.status, 'active')))
    .orderBy(asc(users.firstName));
  return c.json(rows);
});

meetingRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  const a = await meetingAccess(db, user, meeting);
  if (!a.edit) throw new HTTPException(a.member ? 403 : 404, { message: 'forbidden' });
  const input = await parseBody(c, updateMeetingSchema);
  // The meeting's leader fills in place, topic, type, notes and who buys snacks.
  const managerOnly = [
    'status',
    'title',
    'date',
    'startTime',
    'durationMin',
    'leaderUserId',
    'budgetCents',
    'audience',
  ] as const;
  if (!a.manage && managerOnly.some((k) => input[k] !== undefined))
    throw new HTTPException(403, { message: 'forbidden' });
  if (input.status === 'cancelled' && meeting.status === 'done') {
    throw new HTTPException(409, { message: 'has_roll_call' });
  }
  if (input.leaderUserId) await assertActiveMember(db, meeting.groupId, input.leaderUserId);
  if (input.snackUserId) await assertActiveMember(db, meeting.groupId, input.snackUserId);
  if (input.audience !== undefined)
    await setAudience(db, meeting.groupId, meeting.id, input.audience ?? []);

  const patch: Partial<typeof meetings.$inferInsert> = {};
  if (input.status !== undefined && meeting.status !== 'done') patch.status = input.status;
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.location !== undefined) patch.location = input.location;
  if (input.topic !== undefined) patch.topic = input.topic;
  if (input.kind !== undefined) patch.kind = input.kind;
  // A new person hasn't been told yet; the message is sent separately, when chosen.
  if (input.leaderUserId !== undefined && input.leaderUserId !== meeting.leaderUserId) {
    patch.leaderUserId = input.leaderUserId;
    patch.leaderNotifiedAt = null;
  }
  if (input.snackUserId !== undefined && input.snackUserId !== meeting.snackUserId) {
    patch.snackUserId = input.snackUserId;
    patch.snackNotifiedAt = null;
  }
  if (input.budgetCents !== undefined) patch.budgetCents = input.budgetCents;
  if (input.date || input.startTime || input.durationMin) {
    const { timezone } = await getChurch(db);
    const oldStart = new Date(meeting.startsAt);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(oldStart);
    const part = (t: string) => fmt.find((p) => p.type === t)?.value ?? '';
    const date = input.date ?? `${part('year')}-${part('month')}-${part('day')}`;
    const time = input.startTime ?? `${part('hour')}:${part('minute')}`;
    const duration =
      input.durationMin ??
      Math.round((new Date(meeting.endsAt).getTime() - oldStart.getTime()) / 60_000);
    const startsAt = zonedToUtc(date, time, timezone);
    if (Number.isNaN(startsAt.getTime()))
      throw new HTTPException(400, { message: 'validation_error' });
    patch.startsAt = startsAt.toISOString();
    patch.endsAt = new Date(startsAt.getTime() + duration * 60_000).toISOString();
  }
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
  const updated = (await db.query.meetings.findFirst({ where: eq(meetings.id, meeting.id) }))!;

  return c.json((await toMeetingRows(db, [updated]))[0]);
});

/**
 * Message the meeting's leader (managers) or snack person (managers and the leader),
 * with the meeting notes — which are saved on the meeting at the same time.
 */
meetingRoutes.post('/:id/notify', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  const a = await meetingAccess(db, user, meeting);
  const input = await parseBody(c, notifyMeetingSchema);
  if (input.role === 'leader' ? !a.manage : !a.edit)
    throw new HTTPException(a.member ? 403 : 404, { message: 'forbidden' });
  const userId = input.role === 'leader' ? meeting.leaderUserId : meeting.snackUserId;
  if (!userId) throw new HTTPException(409, { message: 'nobody_assigned' });
  if (input.notes !== undefined) {
    await db.update(meetings).set({ notes: input.notes }).where(eq(meetings.id, meeting.id));
  }
  const updated = (await db.query.meetings.findFirst({ where: eq(meetings.id, meeting.id) }))!;
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, meeting.groupId) }))!;
  const sent = await notifyMeetingRole(db, {
    meeting: updated,
    groupName: group.name,
    userId,
    role: input.role,
    budgetCents: updated.budgetCents ?? group.meetingBudgetCents,
    envAppUrl: c.env.APP_URL,
    fallbackUrl: appUrlFor(c.env, c.req.url),
    notes: updated.notes,
  });
  if (sent) {
    await db
      .update(meetings)
      .set(
        input.role === 'leader'
          ? { leaderNotifiedAt: new Date().toISOString() }
          : { snackNotifiedAt: new Date().toISOString() },
      )
      .where(eq(meetings.id, meeting.id));
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 10 }).catch((err) =>
        console.error('meeting drain', err),
      ),
    );
  }
  return c.json({ sent });
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
