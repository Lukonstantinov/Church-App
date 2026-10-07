import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import {
  addHelperSchema,
  sendRosterSchema,
  updateHelperSchema,
  meetingServicesSchema,
  createMeetingSchema,
  personPhotoSchema,
  createScheduleSchema,
  saveRollSchema,
  addDays,
  displayName,
  answerMeetingSchema,
  calendarNoteSchema,
  localDate,
  messageTemplateSchema,
  MEETING_NOTICES,
  announceMeetingSchema,
  meetingRsvpSchema,
  type MeetingNotice,
  notifyMeetingSchema,
  type CalendarData,
  updateMeetingSchema,
  updateScheduleSchema,
  zonedToUtc,
  type AssignmentRow,
  type MeetingDetail,
  type MessageTemplateRow,
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
  calendarNotes,
  groups,
  meetingAudience,
  meetingHelpers,
  meetingRsvps,
  messageTemplates,
  transactions,
  users,
  type Meeting,
  type MeetingSchedule,
} from '../db/schema';
import {
  accessIn,
  assertCan,
  assertCanViewGroup,
  assertMayDesign,
  can,
  designRights,
  lookDiffers,
} from '../lib/access';
import { listEvents } from '../lib/events';
import {
  answerMeetingRole,
  defaultMeetingText,
  fillTemplate,
  notifyMeetingRole,
  toTemplate,
} from '../lib/meetingNotify';
import { assertGroupMedia, assertSpeakerPhotos } from '../lib/media';
import { drainOutbox } from '../lib/outbox';
import {
  announceMeeting,
  answerMeetingRsvp,
  defaultMeetingAnnouncement,
  meetingRsvpLists,
} from '../lib/meetingAnnounce';
import { appUrlFor, botApi } from '../lib/telegram';
import { audit } from '../lib/audit';
import { churchDefaultLocale, getChurch, localeOf } from '../lib/church';
import {
  audienceOf,
  editWindow,
  meetingIsFor,
  generateMeetings,
  groupStats,
  meetingPeople,
  memberAttendance,
  rosterFor,
  toMeetingRows,
  repeatDates,
  readServices,
} from '../lib/meetings';
import { answerHelper, listHelpers, notifyHelper } from '../lib/meetingHelpers';
import { sendMeetingRoster } from '../lib/meetingRoster';
import { idParam, parseBody } from './util';
import { z } from 'zod';

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
 * The ministry calendar for anyone in it: meetings of the past year and all coming ones
 * (those meant for them; leaders see all), events likewise, and leaders' colour notes.
 * Past meetings stay: they hold the roll call and the statistics.
 */
groupMeetingRoutes.get('/:id/calendar', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanViewGroup(db, user, idParam(c));
  const access = await accessIn(db, user, group.id);
  const manage = access.perms.has('meetings.manage');
  const yearAgo = new Date(Date.now() - 366 * 86_400_000).toISOString();
  const coming = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.groupId, group.id), gte(meetings.endsAt, yearAgo)))
    .orderBy(asc(meetings.startsAt))
    .limit(800);
  const audience = await audienceOf(
    db,
    coming.map((m) => m.id),
  );
  const visible = manage ? coming : coming.filter((m) => meetingIsFor(audience, m.id, user.id));
  const today = localDate(new Date(), (await getChurch(db)).timezone);
  const body: CalendarData = {
    meetings: await toMeetingRows(db, visible, c.env.WEBHOOK_SECRET),
    events: [
      ...(await listEvents(db, c.env.WEBHOOK_SECRET, [group.id], user.id, 'past', 100)).reverse(),
      ...(await listEvents(db, c.env.WEBHOOK_SECRET, [group.id], user.id, 'upcoming')),
    ],
    notes: manage
      ? (
          await db
            .select()
            .from(calendarNotes)
            .where(
              and(
                eq(calendarNotes.groupId, group.id),
                gte(calendarNotes.date, addDays(today, -31)),
              ),
            )
            .orderBy(asc(calendarNotes.date))
            .limit(300)
        ).map((n) => ({ id: n.id, date: n.date, text: n.text, color: n.color }))
      : null,
    canNote: manage,
  };
  return c.json(body);
});

/** The ministry's saved services for meetings (people with meetings rights change the list). */
groupMeetingRoutes.put('/:id/services', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'meetings.manage');
  const { services } = await parseBody(c, meetingServicesSchema);
  await db
    .update(groups)
    .set({ meetingServices: services.length ? JSON.stringify(services) : null })
    .where(eq(groups.id, group.id));
  return c.json(services);
});

/** A leader's colour note on a calendar day. */
groupMeetingRoutes.post('/:id/calendar-notes', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'meetings.manage');
  const input = await parseBody(c, calendarNoteSchema);
  const [row] = await db
    .insert(calendarNotes)
    .values({ groupId: group.id, ...input, createdBy: user.id })
    .returning();
  return c.json({ id: row!.id, date: row!.date, text: row!.text, color: row!.color }, 201);
});

export const calendarNoteRoutes = new Hono<App>();

async function loadNote(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const note = await db.query.calendarNotes.findFirst({ where: eq(calendarNotes.id, id) });
  if (!note || !(await can(db, user, note.groupId, 'meetings.manage')))
    throw new HTTPException(404, { message: 'not_found' });
  return { db, note };
}

calendarNoteRoutes.patch('/:id', async (c) => {
  const { db, note } = await loadNote(c, idParam(c));
  const input = await parseBody(c, calendarNoteSchema.partial());
  await db.update(calendarNotes).set(input).where(eq(calendarNotes.id, note.id));
  return c.json({ ok: true });
});

calendarNoteRoutes.delete('/:id', async (c) => {
  const { db, note } = await loadNote(c, idParam(c));
  await db.delete(calendarNotes).where(eq(calendarNotes.id, note.id));
  return c.json({ ok: true });
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
  return c.json(await toMeetingRows(db, list, c.env.WEBHOOK_SECRET));
});

/** One-off meeting (event, camp, a missed date being recorded after the fact). */
groupMeetingRoutes.post('/:id/meetings', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'meetings.manage');
  const input = await parseBody(c, createMeetingSchema);
  const { timezone } = await getChurch(db);
  await assertSpeakerPhotos(db, group.id, input.speakers);
  const design = input.design?.custom?.backdrop?.mediaId;
  if (design) await assertGroupMedia(db, group.id, design);
  // A repeating meeting: every date is made now, so the calendar is full right away.
  const dates = input.repeat ? repeatDates(input.date, input.repeat) : [input.date];
  const seriesId = input.repeat ? crypto.randomUUID() : null;
  const starts = dates.map((d) => zonedToUtc(d, input.startTime, timezone));
  if (starts.some((d) => Number.isNaN(d.getTime())))
    throw new HTTPException(400, { message: 'validation_error' });
  const made = [];
  for (const start of starts) {
    const [created] = await db
      .insert(meetings)
      .values({
        groupId: group.id,
        title: input.title,
        kind: input.kind ?? null,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + input.durationMin * 60_000).toISOString(),
        design: input.design ? JSON.stringify(input.design) : null,
        templateId: input.templateId ?? null,
        speakers: input.speakers?.length ? JSON.stringify(input.speakers) : null,
        posterMotion: input.posterMotion ?? null,
        seriesId,
        repeatRule: input.repeat ? JSON.stringify(input.repeat) : null,
        // Already underway when it is made: nobody needs a "live" message for it.
        liveNotifiedAt: start <= new Date() ? new Date().toISOString() : null,
      })
      .returning();
    made.push(created!);
    if (input.audience?.length) await setAudience(db, group.id, created!.id, input.audience);
  }
  const row = made[0]!;
  await audit(db, {
    actorUserId: user.id,
    action: 'meeting_created',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: { meetingId: row.id, count: made.length },
  });
  return c.json((await toMeetingRows(db, [row], c.env.WEBHOOK_SECRET))[0], 201);
});

/** Deletes meetings together with who they were for, the answers and the helpers. */
async function removeMeetings(db: AuthVariables['db'], where: SQL) {
  const ids = (await db.select({ id: meetings.id }).from(meetings).where(where)).map((m) => m.id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    await db.delete(meetingHelpers).where(inArray(meetingHelpers.meetingId, chunk));
    await db.delete(attendance).where(inArray(attendance.meetingId, chunk));
    // Money stays in the books, just no longer tied to the meeting.
    await db
      .update(transactions)
      .set({ meetingId: null })
      .where(inArray(transactions.meetingId, chunk));
    await db.delete(meetingAudience).where(inArray(meetingAudience.meetingId, chunk));
    await db.delete(meetingRsvps).where(inArray(meetingRsvps.meetingId, chunk));
    await db.delete(meetings).where(inArray(meetings.id, chunk));
  }
}

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
    await removeMeetings(db, futureEmpty!);
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
  await removeMeetings(
    db,
    and(
      eq(meetings.scheduleId, schedule.id),
      eq(meetings.status, 'scheduled'),
      gte(meetings.startsAt, new Date().toISOString()),
    )!,
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
/** A meeting's look: the poster, its template, the living wallpaper and the people block. */
const MEETING_LOOK = [
  'design',
  'templateId',
  'motion',
  'tileMotion',
  'posterMotion',
  'peopleLook',
] as const;

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
  const rights = await designRights(db, user, meeting.groupId);
  // A meeting for chosen people is hidden from everyone else (managers see all).
  if (!a.edit && !meetingIsFor(await audienceOf(db, [meeting.id]), meeting.id, user.id))
    throw new HTTPException(404, { message: 'not_found' });
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, meeting.groupId) }))!;
  const [row] = await toMeetingRows(db, [meeting], c.env.WEBHOOK_SECRET);
  const rsvp = await meetingRsvpLists(db, meeting.id);
  const seeRoll = a.roll || a.edit;
  const detail: MeetingDetail = {
    ...row!,
    counts: seeRoll ? row!.counts : { present: 0, late: 0, excused: 0, absent: 0 },
    guestCount: seeRoll ? row!.guestCount : 0,
    budgetCents: a.money || a.edit ? row!.budgetCents : null,
    groupName: group.name,
    defaultLocation: group.defaultLocation,
    canEdit: a.edit,
    canManage: a.manage,
    canDesign: rights.designer || (!rights.locked && a.edit),
    myRole:
      meeting.leaderUserId === user.id
        ? 'leader'
        : meeting.snackUserId === user.id
          ? 'snack'
          : null,
    myAcceptedAt:
      meeting.leaderUserId === user.id
        ? meeting.leaderAcceptedAt
        : meeting.snackUserId === user.id
          ? meeting.snackAcceptedAt
          : null,
    announcedAt: meeting.announcedAt,
    rsvp: {
      asked: meeting.askRsvp,
      mine: rsvp.rows.find((r) => r.id === user.id)?.status ?? null,
      going: rsvp.going,
      notGoing: rsvp.notGoing,
    },
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
  const rights = await designRights(db, user, meeting.groupId);
  // A designer may change only the look of a meeting they can't otherwise edit.
  if (!a.edit && !rights.designer)
    throw new HTTPException(a.member ? 403 : 404, { message: 'forbidden' });
  const input = await parseBody(c, updateMeetingSchema);
  const given = (Object.keys(input) as (keyof typeof input)[]).filter(
    (k) => input[k] !== undefined && k !== 'applyToSeries',
  );
  if (MEETING_LOOK.some((k) => lookDiffers(input[k], meeting[k]))) assertMayDesign(rights, a.edit);
  // Speakers are on the poster too, so a designer may set them.
  if (
    !a.edit &&
    given.some((k) => !(MEETING_LOOK as readonly string[]).includes(k) && k !== 'speakers')
  )
    throw new HTTPException(403, { message: 'forbidden' });
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
  if (input.design !== undefined) {
    const photo = input.design?.custom?.backdrop?.mediaId;
    if (photo) await assertGroupMedia(db, meeting.groupId, photo);
    patch.design = input.design ? JSON.stringify(input.design) : null;
  }
  if (input.templateId !== undefined) patch.templateId = input.templateId;
  if (input.motion !== undefined) patch.motion = input.motion;
  if (input.tileMotion !== undefined) patch.tileMotion = input.tileMotion;
  if (input.posterMotion !== undefined) patch.posterMotion = input.posterMotion;
  if (input.peopleLook !== undefined) {
    if (input.peopleLook?.photoMediaId)
      await assertGroupMedia(db, meeting.groupId, input.peopleLook.photoMediaId);
    patch.peopleLook = input.peopleLook ? JSON.stringify(input.peopleLook) : null;
  }
  if (input.speakers !== undefined) {
    await assertSpeakerPhotos(db, meeting.groupId, input.speakers);
    patch.speakers = input.speakers.length ? JSON.stringify(input.speakers) : null;
  }
  // A new person hasn't been told yet; the message is sent separately, when chosen.
  if (input.leaderUserId !== undefined && input.leaderUserId !== meeting.leaderUserId) {
    patch.leaderUserId = input.leaderUserId;
    patch.leaderDeclinedBy = null;
    patch.leaderNotifiedAt = null;
    patch.leaderAcceptedAt = null;
  }
  if (input.snackUserId !== undefined && input.snackUserId !== meeting.snackUserId) {
    patch.snackUserId = input.snackUserId;
    patch.snackDeclinedBy = null;
    patch.snackNotifiedAt = null;
    patch.snackAcceptedAt = null;
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
    // Moved: the "live" message goes again for the new time (reminders follow the time anyway).
    patch.liveNotifiedAt = null;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(meetings).set(patch).where(eq(meetings.id, meeting.id));
    // "This and all later meetings": the look and wording follow along (not the times).
    if (input.applyToSeries && meeting.seriesId) {
      const shared: Partial<typeof meetings.$inferInsert> = {};
      for (const k of [
        'title',
        'topic',
        'location',
        'design',
        'templateId',
        'speakers',
        'kind',
      ] as const)
        if (k in patch) (shared as Record<string, unknown>)[k] = patch[k];
      if (Object.keys(shared).length > 0)
        await db
          .update(meetings)
          .set(shared)
          .where(
            and(
              eq(meetings.seriesId, meeting.seriesId),
              gte(meetings.startsAt, meeting.startsAt),
              eq(meetings.status, 'scheduled'),
            ),
          );
    }
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

  return c.json((await toMeetingRows(db, [updated], c.env.WEBHOOK_SECRET))[0]);
});

/** Who may message whom: managers the leader; managers and the leader the snack person. */
async function notifyTarget(
  c: { get: (k: 'db' | 'user') => unknown },
  id: number,
  role: 'leader' | 'snack',
) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  const a = await meetingAccess(db, user, meeting);
  if (role === 'leader' ? !a.manage : !a.edit)
    throw new HTTPException(a.member ? 403 : 404, { message: 'forbidden' });
  const userId = role === 'leader' ? meeting.leaderUserId : meeting.snackUserId;
  if (!userId) throw new HTTPException(409, { message: 'nobody_assigned' });
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, meeting.groupId) }))!;
  return { db, user, meeting, group, userId };
}

/**
 * The message to read and edit before sending: the default wording, or a saved one
 * (`template=<id>`) filled in for this meeting.
 */
meetingRoutes.get('/:id/notify-text', async (c) => {
  const role = c.req.query('role') === 'snack' ? 'snack' : 'leader';
  const { db, meeting, group, userId } = await notifyTarget(c, idParam(c), role);
  const notes = c.req.query('notes');
  const args = {
    meeting,
    groupName: group.name,
    userId,
    role,
    budgetCents: meeting.budgetCents ?? group.meetingBudgetCents,
    notes: notes === undefined ? meeting.notes : notes || null,
  } as const;
  const templateId = Number(c.req.query('template'));
  if (Number.isSafeInteger(templateId) && templateId > 0) {
    const saved = await db.query.messageTemplates.findFirst({
      where: and(
        eq(messageTemplates.id, templateId),
        eq(messageTemplates.groupId, meeting.groupId),
        eq(messageTemplates.role, role),
      ),
    });
    if (!saved) throw new HTTPException(404, { message: 'not_found' });
    return c.json({ text: await fillTemplate(db, saved.text, args) });
  }
  return c.json({ text: await defaultMeetingText(db, args) });
});

/** Saved wordings for this ministry (for the send box). */
meetingRoutes.get('/:id/message-templates', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  const a = await meetingAccess(db, user, meeting);
  if (!a.edit) throw new HTTPException(a.member ? 403 : 404, { message: 'forbidden' });
  const rows = await db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.groupId, meeting.groupId))
    .orderBy(asc(messageTemplates.name));
  const out: MessageTemplateRow[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    name: r.name,
    text: r.text,
    canDelete: a.manage || r.createdBy === user.id,
  }));
  return c.json(out);
});

/**
 * Save the message the sender is looking at as a new wording. The meeting's own values
 * (title, ministry, date, amount, name, notes) become placeholders again.
 */
meetingRoutes.post('/:id/message-templates', async (c) => {
  const input = await parseBody(c, messageTemplateSchema);
  const { db, user, meeting, group, userId } = await notifyTarget(c, idParam(c), input.role);
  const text = await toTemplate(db, input.text, {
    meeting,
    groupName: group.name,
    userId,
    role: input.role,
    budgetCents: meeting.budgetCents ?? group.meetingBudgetCents,
    notes: meeting.notes,
  });
  const [row] = await db
    .insert(messageTemplates)
    .values({
      groupId: meeting.groupId,
      role: input.role,
      name: input.name,
      text,
      createdBy: user.id,
    })
    .returning();
  return c.json(
    {
      id: row!.id,
      role: row!.role,
      name: row!.name,
      text: row!.text,
      canDelete: true,
    } satisfies MessageTemplateRow,
    201,
  );
});

/**
 * Send the leader or snack person the message (as edited, else the default), with
 * "Agree" / "Can't" buttons and an optional poster. The notes are saved on the meeting.
 */
meetingRoutes.post('/:id/notify', async (c) => {
  const input = await parseBody(c, notifyMeetingSchema);
  const { db, user, meeting, group, userId } = await notifyTarget(c, idParam(c), input.role);
  if (input.notes !== undefined) {
    await db.update(meetings).set({ notes: input.notes }).where(eq(meetings.id, meeting.id));
  }
  if (input.posterMediaId) await assertGroupMedia(db, meeting.groupId, input.posterMediaId);
  const updated = (await db.query.meetings.findFirst({ where: eq(meetings.id, meeting.id) }))!;
  const text =
    input.text ??
    (await defaultMeetingText(db, {
      meeting: updated,
      groupName: group.name,
      userId,
      role: input.role,
      budgetCents: updated.budgetCents ?? group.meetingBudgetCents,
      notes: updated.notes,
    }));
  const sent = await notifyMeetingRole(db, {
    meeting: updated,
    userId,
    role: input.role,
    text,
    senderName: displayName(user),
    posterMediaId: input.posterMediaId ?? null,
    envAppUrl: c.env.APP_URL,
    fallbackUrl: appUrlFor(c.env, c.req.url),
  });
  if (sent) {
    const now = new Date().toISOString();
    await db
      .update(meetings)
      .set(
        input.role === 'leader'
          ? { leaderNotifiedAt: now, leaderNotifiedBy: user.id, leaderAcceptedAt: null }
          : { snackNotifiedAt: now, snackNotifiedBy: user.id, snackAcceptedAt: null },
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

/** A meeting the user may announce (needs the right to manage meetings). */
async function announceable(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  await assertCan(db, user, meeting.groupId, 'meetings.manage');
  return { db, user, meeting };
}

/** The default announcement, in the sender's language, to read and change before sending. */
meetingRoutes.get('/:id/announce-text', async (c) => {
  const { db, user, meeting } = await announceable(c, idParam(c));
  const locale = localeOf(user, await churchDefaultLocale(db));
  const raw = c.req.query('notice');
  const notice = (MEETING_NOTICES as readonly string[]).includes(raw ?? '')
    ? (raw as MeetingNotice)
    : 'announce';
  const from = c.req.query('from');
  const previous = from && !Number.isNaN(Date.parse(from)) ? from : null;
  return c.json({
    text: await defaultMeetingAnnouncement(db, meeting, locale, notice, previous),
  });
});

/** Tell everyone (or leaders / chosen people) about the meeting, with its poster. */
meetingRoutes.post('/:id/announce', async (c) => {
  const { db, user, meeting } = await announceable(c, idParam(c));
  const input = await parseBody(c, announceMeetingSchema);
  // A cancelled meeting can only be announced as cancelled.
  if ((meeting.status === 'cancelled') !== (input.notice === 'cancelled'))
    throw new HTTPException(409, { message: 'cancelled' });
  if (input.posterMediaId) await assertGroupMedia(db, meeting.groupId, input.posterMediaId);
  if (input.notice !== 'cancelled')
    await db
      .update(meetings)
      .set({
        announcedBy: user.id,
        announcedAt: new Date().toISOString(),
        ...(input.ask ? { askRsvp: true } : {}),
      })
      .where(eq(meetings.id, meeting.id));
  const { total, bot } = await announceMeeting(db, {
    meeting,
    notice: input.notice,
    ask: input.ask,
    previousStartsAt: input.previousStartsAt,
    text: input.text,
    userIds: input.userIds,
    posterMediaId: input.posterMediaId,
    senderName: displayName(user),
    envAppUrl: c.env.APP_URL,
    fallbackUrl: appUrlFor(c.env, c.req.url),
  });
  if (bot > 0)
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 100 }).catch((err) =>
        console.error('announce drain', err),
      ),
    );
  await audit(db, {
    actorUserId: user.id,
    action: 'meeting_announced',
    entity: 'group',
    entityId: meeting.groupId,
    groupId: meeting.groupId,
    data: { meetingId: meeting.id, sent: total, chosen: input.userIds?.length ?? null },
  });
  return c.json({ sent: total, bot });
});

/** "Will you come?" — the person's own answer (from the app). */
meetingRoutes.post('/:id/rsvp', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  if (meeting.status === 'cancelled') throw new HTTPException(409, { message: 'cancelled' });
  const { status } = await parseBody(c, meetingRsvpSchema);
  const ok = await answerMeetingRsvp(db, {
    meeting,
    user,
    status,
    envAppUrl: c.env.APP_URL,
    fallbackUrl: appUrlFor(c.env, c.req.url),
  });
  if (!ok) throw new HTTPException(403, { message: 'forbidden' });
  c.executionCtx.waitUntil(
    drainOutbox(db, botApi(c.env), { limit: 10 }).catch((err) => console.error('rsvp drain', err)),
  );
  return c.json({ ok: true });
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
    meeting: (await toMeetingRows(db, [meeting], c.env.WEBHOOK_SECRET))[0]!,
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
  return c.json((await toMeetingRows(db, [updated!], c.env.WEBHOOK_SECRET))[0] as MeetingRow);
});

/** The assigned person answers "Agree" / "Can't" in the app (as with the bot buttons). */
meetingRoutes.post('/:id/answer', async (c) => {
  const input = await parseBody(c, answerMeetingSchema);
  const db = c.get('db');
  const api = botApi(c.env);
  const result = await answerMeetingRole(db, api, {
    meetingId: idParam(c),
    role: input.role,
    agree: input.agree,
    user: c.get('user'),
  });
  if (result === 'not_yours') throw new HTTPException(403, { message: 'not_yours' });
  return c.json({ ok: true });
});

// ---------- people with a job at a meeting ----------

/** A meeting the user manages (to add, ask or remove its people). */
async function managedMeeting(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  await assertCan(db, user, meeting.groupId, 'meetings.manage');
  return { db, user, meeting };
}

/**
 * Deletes one meeting for good (people with meetings rights, after confirming twice in
 * the app). Nothing else removes past meetings: they keep the roll call and statistics.
 * Money linked to it stays in the books.
 */
meetingRoutes.delete('/:id', async (c) => {
  const { db, user, meeting } = await managedMeeting(c, idParam(c));
  await removeMeetings(db, eq(meetings.id, meeting.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'meeting_deleted',
    entity: 'group',
    entityId: meeting.groupId,
    groupId: meeting.groupId,
    data: { meetingId: meeting.id, title: meeting.title, startsAt: meeting.startsAt },
  });
  return c.json({ ok: true });
});

meetingRoutes.post('/:id/helpers', async (c) => {
  const { db, meeting } = await managedMeeting(c, idParam(c));
  const input = await parseBody(c, addHelperSchema);
  await assertActiveMember(db, meeting.groupId, input.userId);
  const speaker = input.speaker ?? false;
  const icon = input.icon ?? (speaker ? '🎤' : null);
  await db
    .insert(meetingHelpers)
    .values({ meetingId: meeting.id, userId: input.userId, role: input.role, icon, speaker });
  // A new service is remembered by the ministry, to pick it next time.
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, meeting.groupId) }))!;
  const saved = readServices(group.meetingServices);
  const key = input.role.toLocaleLowerCase();
  if (!saved.some((x) => x.name.toLocaleLowerCase() === key) && saved.length < 40)
    await db
      .update(groups)
      .set({
        meetingServices: JSON.stringify([
          ...saved,
          { name: input.role, icon: icon ?? '🙌', speaker },
        ]),
      })
      .where(eq(groups.id, group.id));
  return c.json(await listHelpers(db, meeting.id, c.env.WEBHOOK_SECRET), 201);
});

meetingRoutes.delete('/:id/helpers/:helperId', async (c) => {
  const { db, meeting } = await managedMeeting(c, idParam(c));
  await db
    .delete(meetingHelpers)
    .where(
      and(
        eq(meetingHelpers.id, Number(c.req.param('helperId'))),
        eq(meetingHelpers.meetingId, meeting.id),
      ),
    );
  return c.json(await listHelpers(db, meeting.id, c.env.WEBHOOK_SECRET));
});

/** Changes a helper's service name or icon. */
meetingRoutes.patch('/:id/helpers/:helperId', async (c) => {
  const { db, meeting } = await managedMeeting(c, idParam(c));
  const input = await parseBody(c, updateHelperSchema);
  await db
    .update(meetingHelpers)
    .set(input)
    .where(
      and(
        eq(meetingHelpers.id, Number(c.req.param('helperId'))),
        eq(meetingHelpers.meetingId, meeting.id),
      ),
    );
  return c.json(await listHelpers(db, meeting.id, c.env.WEBHOOK_SECRET));
});

/** Sends who serves (every role and person) to everyone at the meeting or only the team. */
meetingRoutes.post('/:id/roster', async (c) => {
  const { db, user, meeting } = await managedMeeting(c, idParam(c));
  const { to } = await parseBody(c, sendRosterSchema);
  const result = await sendMeetingRoster(db, {
    meeting,
    to,
    senderName: displayName(user),
    envAppUrl: c.env.APP_URL,
    fallbackUrl: appUrlFor(c.env, c.req.url),
  });
  if (result.bot > 0)
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 50 }).catch((err) =>
        console.error('roster drain', err),
      ),
    );
  return c.json(result);
});

/** Asks the helper by bot (again); their answer comes back as a mark. */
meetingRoutes.post('/:id/helpers/:helperId/notify', async (c) => {
  const { db, user, meeting } = await managedMeeting(c, idParam(c));
  const helperId = Number(c.req.param('helperId'));
  const helper = await db.query.meetingHelpers.findFirst({
    where: and(eq(meetingHelpers.id, helperId), eq(meetingHelpers.meetingId, meeting.id)),
  });
  if (!helper) throw new HTTPException(404, { message: 'not_found' });
  const sent = await notifyHelper(db, {
    helperId,
    senderId: user.id,
    senderName: displayName(user),
    envAppUrl: c.env.APP_URL,
    fallbackUrl: appUrlFor(c.env, c.req.url),
  });
  if (sent)
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 10 }).catch((err) =>
        console.error('helper drain', err),
      ),
    );
  return c.json({ sent });
});

/** A helper answers in the app (same as the bot buttons). */
meetingRoutes.post('/:id/helpers/:helperId/answer', async (c) => {
  const db = c.get('db');
  const { agree } = await parseBody(c, z.object({ agree: z.boolean() }));
  const result = await answerHelper(db, botApi(c.env), {
    helperId: Number(c.req.param('helperId')),
    agree,
    user: c.get('user'),
  });
  if (result === 'not_yours') throw new HTTPException(403, { message: 'not_yours' });
  return c.json({ ok: true });
});

/**
 * A person's photo for the meeting cards: managers of the meeting's ministry set anyone's
 * in it, everyone their own. The picture must be one of the ministry's uploads.
 */
meetingRoutes.put('/:id/people/:userId/photo', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, idParam(c)) });
  if (!meeting) throw new HTTPException(404, { message: 'not_found' });
  const userId = Number(c.req.param('userId'));
  if (userId !== user.id) await assertCan(db, user, meeting.groupId, 'meetings.manage');
  await assertActiveMember(db, meeting.groupId, userId);
  const { mediaId } = await parseBody(c, personPhotoSchema);
  if (mediaId) await assertGroupMedia(db, meeting.groupId, mediaId);
  await db.update(users).set({ photoMediaId: mediaId }).where(eq(users.id, userId));
  return c.json({ ok: true });
});

/** Remove a saved wording (managers, or the one who saved it). */
export const messageTemplateRoutes = new Hono<App>();

messageTemplateRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const row = await db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.id, idParam(c)),
  });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  const access = await accessIn(db, user, row.groupId);
  if (row.createdBy !== user.id && !access.perms.has('meetings.manage'))
    throw new HTTPException(403, { message: 'forbidden' });
  await db.delete(messageTemplates).where(eq(messageTemplates.id, row.id));
  return c.json({ ok: true });
});

// ---------- /api/me/assignments ----------

export const myAssignmentRoutes = new Hono<App>();

/** Coming meetings where the person leads or buys the snacks, soonest first. */
myAssignmentRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  // A meeting that started a few hours ago is still "now".
  const since = new Date(Date.now() - 4 * 3600_000).toISOString();
  const rows = await db
    .select({ m: meetings, group: groups })
    .from(meetings)
    .innerJoin(groups, eq(groups.id, meetings.groupId))
    .where(
      and(
        eq(meetings.status, 'scheduled'),
        gte(meetings.startsAt, since),
        or(eq(meetings.leaderUserId, user.id), eq(meetings.snackUserId, user.id)),
      ),
    )
    .orderBy(asc(meetings.startsAt))
    .limit(20);
  const people = await meetingPeople(
    db,
    rows.flatMap(({ m }) => [m.leaderUserId, m.snackUserId]),
  );
  const out: AssignmentRow[] = [];
  for (const { m, group } of rows) {
    for (const role of ['leader', 'snack'] as const) {
      if ((role === 'leader' ? m.leaderUserId : m.snackUserId) !== user.id) continue;
      out.push({
        meetingId: m.id,
        groupId: m.groupId,
        groupName: group.name,
        title: m.title,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        role,
        topic: m.topic,
        location: m.location,
        kind: m.kind as AssignmentRow['kind'],
        leader: m.leaderUserId ? (people.get(m.leaderUserId) ?? null) : null,
        snackPerson: m.snackUserId ? (people.get(m.snackUserId) ?? null) : null,
        budgetCents: m.budgetCents ?? group.meetingBudgetCents,
        notes: m.notes,
        acceptedAt: role === 'leader' ? m.leaderAcceptedAt : m.snackAcceptedAt,
        missing:
          role === 'leader'
            ? [
                ...(m.location ? [] : (['location'] as const)),
                ...(m.topic ? [] : (['topic'] as const)),
                ...(m.snackUserId ? [] : (['snack'] as const)),
              ]
            : [],
      });
    }
  }
  return c.json(out);
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
