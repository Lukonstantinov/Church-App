import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  absenceStreak,
  addDays,
  attendanceRate,
  DAY_MS,
  localDate,
  ROLL_EDIT_WINDOW_DAYS,
  weekdayOf,
  zonedToUtc,
  type AttendanceStatus,
  type AttendancePoint,
  type GroupStats,
  MEETING_KINDS,
  type MeetingKind,
  type MeetingPerson,
  type MeetingRow,
  type MemberAttendance,
  type RollEntry,
} from '@church/shared';
import type { Db } from '../db/client';
import {
  attendance,
  groups,
  meetingSchedules,
  meetings,
  memberships,
  users,
  type Meeting,
} from '../db/schema';

const emptyCounts = (): Record<AttendanceStatus, number> => ({
  present: 0,
  late: 0,
  excused: 0,
  absent: 0,
});

// ---------- generation ----------

/**
 * Creates meetings from active schedules for the next `horizonDays` days.
 * Idempotent (unique schedule+start). Skips occurrences that already ended before
 * the schedule was created, so new schedules don't spawn "missing roll call" reminders.
 */
export async function generateMeetings(
  db: Db,
  timezone: string,
  {
    now = new Date(),
    // Far enough ahead to plan who leads each meeting.
    horizonDays = 91,
    groupId,
  }: { now?: Date; horizonDays?: number; groupId?: number } = {},
): Promise<number> {
  const rows = await db
    .select({ schedule: meetingSchedules })
    .from(meetingSchedules)
    .innerJoin(groups, eq(groups.id, meetingSchedules.groupId))
    .where(
      and(
        eq(meetingSchedules.active, true),
        isNull(groups.archivedAt),
        groupId === undefined ? undefined : eq(meetingSchedules.groupId, groupId),
      ),
    );

  const today = localDate(now, timezone);
  const inserts = [];
  for (const { schedule } of rows) {
    for (let i = 0; i <= horizonDays; i++) {
      const date = addDays(today, i);
      if (weekdayOf(date) !== schedule.weekday) continue;
      const startsAt = zonedToUtc(date, schedule.startTime, timezone);
      const endsAt = new Date(startsAt.getTime() + schedule.durationMin * 60_000);
      if (endsAt.toISOString() <= schedule.createdAt) continue;
      inserts.push(
        db
          .insert(meetings)
          .values({
            groupId: schedule.groupId,
            scheduleId: schedule.id,
            title: schedule.title,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            slotAt: startsAt.toISOString(),
          })
          .onConflictDoNothing(),
      );
    }
  }
  for (let i = 0; i < inserts.length; i += 50) {
    const chunk = inserts.slice(i, i + 50);
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
  }
  return inserts.length;
}

// ---------- rows & counts ----------

export async function toMeetingRows(db: Db, list: Meeting[]): Promise<MeetingRow[]> {
  const counts = new Map<number, Record<AttendanceStatus, number>>();
  const doneIds = list.filter((m) => m.status === 'done').map((m) => m.id);
  if (doneIds.length > 0) {
    const rows = await db
      .select({
        meetingId: attendance.meetingId,
        status: attendance.status,
        n: sql<number>`count(*)`,
      })
      .from(attendance)
      .where(inArray(attendance.meetingId, doneIds))
      .groupBy(attendance.meetingId, attendance.status);
    for (const r of rows) {
      const c = counts.get(r.meetingId) ?? emptyCounts();
      c[r.status] = Number(r.n);
      counts.set(r.meetingId, c);
    }
  }
  const people = await meetingPeople(
    db,
    list.flatMap((m) => [m.leaderUserId, m.snackUserId]),
  );
  return list.map((m) => ({
    id: m.id,
    groupId: m.groupId,
    scheduleId: m.scheduleId,
    title: m.title,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    status: m.status,
    guestCount: m.guestCount,
    notes: m.notes,
    rollTakenAt: m.rollTakenAt,
    location: m.location,
    topic: m.topic,
    kind: meetingKind(m.kind),
    leader: (m.leaderUserId && people.get(m.leaderUserId)) || null,
    snackPerson: (m.snackUserId && people.get(m.snackUserId)) || null,
    budgetCents: m.budgetCents,
    counts: counts.get(m.id) ?? emptyCounts(),
  }));
}

export const meetingKind = (v: string | null): MeetingKind | null =>
  (MEETING_KINDS as readonly string[]).includes(v ?? '') ? (v as MeetingKind) : null;

/** Name and username of the people a set of meetings refers to. */
export async function meetingPeople(
  db: Db,
  ids: (number | null)[],
): Promise<Map<number, MeetingPerson>> {
  const unique = [...new Set(ids.filter((x): x is number => x !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------- roll-call roster ----------

/** Start of the local calendar day of `iso`, as an ISO instant. */
function dayStart(iso: string, timezone: string): string {
  return zonedToUtc(localDate(iso, timezone), '00:00', timezone).toISOString();
}

/**
 * Who belongs on a meeting's roll call: active members who had joined by that day
 * (so a newcomer added during the meeting is included), plus anyone who already has
 * a record for it (so editing never silently drops history).
 */
export async function rosterFor(db: Db, meeting: Meeting, timezone: string): Promise<RollEntry[]> {
  // Joined by the end of the meeting's local day → belongs on this roll call.
  const meetingDayEnd = zonedToUtc(
    addDays(localDate(meeting.startsAt, timezone), 1),
    '00:00',
    timezone,
  ).toISOString();

  const [members, marks] = await Promise.all([
    db
      .select({ u: users, joinedAt: memberships.joinedAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupId, meeting.groupId), eq(memberships.status, 'active'))),
    db.select().from(attendance).where(eq(attendance.meetingId, meeting.id)),
  ]);
  const markBy = new Map(marks.map((m) => [m.userId, m.status]));

  const eligible = new Map<number, typeof users.$inferSelect>();
  for (const { u, joinedAt } of members) {
    if (!joinedAt || joinedAt < meetingDayEnd) eligible.set(u.id, u);
  }
  const missing = marks.map((m) => m.userId).filter((id) => !eligible.has(id));
  if (missing.length > 0) {
    for (const u of await db.select().from(users).where(inArray(users.id, missing))) {
      eligible.set(u.id, u);
    }
  }

  // Statuses at the four previous roll calls, for the little history dots.
  const previous = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.groupId, meeting.groupId),
        eq(meetings.status, 'done'),
        lt(meetings.startsAt, meeting.startsAt),
      ),
    )
    .orderBy(desc(meetings.startsAt))
    .limit(4);
  const prevIds = previous.map((p) => p.id); // newest first
  const prevMarks = prevIds.length
    ? await db.select().from(attendance).where(inArray(attendance.meetingId, prevIds))
    : [];
  const prevBy = new Map(prevMarks.map((m) => [`${m.meetingId}:${m.userId}`, m.status]));

  const roster: RollEntry[] = [...eligible.values()].map((u) => ({
    userId: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    offline: u.telegramId === null,
    status: markBy.get(u.id) ?? null,
    recent: [...prevIds].reverse().map((id) => prevBy.get(`${id}:${u.id}`) ?? null),
  }));
  roster.sort(
    (a, b) =>
      a.firstName.localeCompare(b.firstName, 'ru') ||
      (a.lastName ?? '').localeCompare(b.lastName ?? '', 'ru'),
  );
  return roster;
}

export function editWindow(meeting: Meeting, now = new Date()) {
  const until = new Date(new Date(meeting.endsAt).getTime() + ROLL_EDIT_WINDOW_DAYS * DAY_MS);
  return { editableUntil: until.toISOString(), open: now <= until };
}

// ---------- stats ----------

export async function groupStats(db: Db, groupId: number, now = new Date()): Promise<GroupStats> {
  const nowIso = now.toISOString();
  const [counts, done, next, awaiting] = await Promise.all([
    db
      .select({
        status: memberships.status,
        n: sql<number>`count(*)`,
      })
      .from(memberships)
      .where(
        and(eq(memberships.groupId, groupId), inArray(memberships.status, ['active', 'pending'])),
      )
      .groupBy(memberships.status),
    db
      .select()
      .from(meetings)
      .where(and(eq(meetings.groupId, groupId), eq(meetings.status, 'done')))
      .orderBy(desc(meetings.startsAt))
      .limit(8),
    db
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.groupId, groupId),
          eq(meetings.status, 'scheduled'),
          gte(meetings.endsAt, nowIso),
        ),
      )
      .orderBy(asc(meetings.startsAt))
      .limit(1),
    db
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.groupId, groupId),
          eq(meetings.status, 'scheduled'),
          lt(meetings.endsAt, nowIso),
          gte(meetings.endsAt, new Date(now.getTime() - 30 * DAY_MS).toISOString()),
        ),
      )
      .orderBy(desc(meetings.startsAt))
      .limit(5),
  ]);

  const rows = await toMeetingRows(db, done);
  const series: AttendancePoint[] = rows
    .map((m) => ({
      meetingId: m.id,
      startsAt: m.startsAt,
      title: m.title,
      attended: m.counts.present + m.counts.late,
      total: m.counts.present + m.counts.late + m.counts.absent,
    }))
    .reverse();
  const attended = series.reduce((s, p) => s + p.attended, 0);
  const total = series.reduce((s, p) => s + p.total, 0);

  const by = new Map(counts.map((c) => [c.status, Number(c.n)]));
  return {
    activeMembers: by.get('active') ?? 0,
    pendingCount: by.get('pending') ?? 0,
    averageRate: total === 0 ? null : Math.round((attended / total) * 100),
    series,
    nextMeeting: next[0] ? (await toMeetingRows(db, next))[0]! : null,
    awaitingRoll: await toMeetingRows(db, awaiting),
  };
}

/** Attendance summary of one member in one group. */
export async function memberAttendance(
  db: Db,
  args: {
    userId: number;
    groupId: number;
    groupName: string;
    joinedAt: string | null;
    timezone: string;
    now?: Date;
  },
): Promise<MemberAttendance> {
  const { userId, groupId, groupName, joinedAt, timezone } = args;
  const now = args.now ?? new Date();
  const joinedDay = joinedAt ? dayStart(joinedAt, timezone) : null;

  const held = await db
    .select({ id: meetings.id, startsAt: meetings.startsAt })
    .from(meetings)
    .where(and(eq(meetings.groupId, groupId), eq(meetings.status, 'done')))
    .orderBy(desc(meetings.startsAt))
    .limit(200);
  const ids = held.map((m) => m.id);
  const marks: Map<number, AttendanceStatus> = new Map();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    for (const r of await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.userId, userId), inArray(attendance.meetingId, chunk)))) {
      marks.set(r.meetingId, r.status);
    }
  }

  // Held meetings since joining (or with a record), newest first; unmarked = absent.
  const timeline = held
    .filter((m) => marks.has(m.id) || !joinedDay || m.startsAt >= joinedDay)
    .map((m) => ({
      meetingId: m.id,
      startsAt: m.startsAt,
      status: (marks.get(m.id) ?? 'absent') as AttendanceStatus,
    }));
  const statuses = timeline.map((t) => t.status);
  const rate = attendanceRate(statuses);

  const next = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.groupId, groupId),
        eq(meetings.status, 'scheduled'),
        gte(meetings.endsAt, now.toISOString()),
      ),
    )
    .orderBy(asc(meetings.startsAt))
    .limit(1);

  return {
    groupId,
    groupName,
    percent: rate.percent,
    attended: rate.attended,
    counted: rate.counted,
    streak: absenceStreak(statuses),
    recent: timeline.slice(0, 8),
    nextMeeting: next[0]
      ? {
          id: next[0].id,
          title: next[0].title,
          startsAt: next[0].startsAt,
          endsAt: next[0].endsAt,
          location: next[0].location,
          topic: next[0].topic,
          kind: meetingKind(next[0].kind),
          leader: next[0].leaderUserId
            ? ((await meetingPeople(db, [next[0].leaderUserId])).get(next[0].leaderUserId) ?? null)
            : null,
        }
      : null,
  };
}
