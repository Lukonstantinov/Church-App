import { countedWhere } from './statsRule';
import { and, asc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import {
  addDays,
  displayName,
  zonedToUtc,
  type AttendancePoint,
  type GroupStatistics,
  type StatPerson,
} from '@church/shared';
import type { Db } from '../db/client';
import {
  attendance,
  eventRoleAssignees,
  eventRoles,
  eventRsvps,
  events,
  meetings,
  memberships,
  positions,
  users,
  type Group,
} from '../db/schema';

const pct = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 100);

/**
 * The ministry's statistics for a period (local dates, inclusive): totals, attendance over
 * time, by meeting kind, every person, every meeting and every event.
 */
export async function groupStatistics(
  db: Db,
  group: Pick<Group, 'id' | 'name'> & { statKinds?: string[] | null },
  period: { from: string; to: string },
  timezone: string,
): Promise<GroupStatistics> {
  const from = zonedToUtc(period.from, '00:00', timezone).toISOString();
  const to = zonedToUtc(addDays(period.to, 1), '00:00', timezone).toISOString();
  const inPeriod = and(
    eq(meetings.groupId, group.id),
    gte(meetings.startsAt, from),
    lt(meetings.startsAt, to),
  );

  const [held, cancelled, members, evs] = await Promise.all([
    db
      .select()
      .from(meetings)
      // Only meetings that count (the ministry's rule and each meeting's own choice).
      .where(and(inPeriod, eq(meetings.status, 'done'), countedWhere(group.statKinds)))
      .orderBy(asc(meetings.startsAt))
      .limit(500),
    db
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(inPeriod, eq(meetings.status, 'cancelled'))),
    db
      .select({ m: memberships, u: users, positionName: positions.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(positions, eq(positions.id, memberships.positionId))
      .where(eq(memberships.groupId, group.id)),
    db
      .select()
      .from(events)
      .where(
        and(
          eq(events.groupId, group.id),
          ne(events.status, 'cancelled'),
          gte(events.startsAt, from),
          lt(events.startsAt, to),
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(200),
  ]);

  const ids = held.map((m) => m.id);
  const marks = ids.length
    ? await db
        .select({
          meetingId: attendance.meetingId,
          userId: attendance.userId,
          status: attendance.status,
        })
        .from(attendance)
        .where(inArray(attendance.meetingId, ids))
    : [];

  const eventIds = evs.map((e) => e.id);
  const [roles, rsvps] = eventIds.length
    ? await Promise.all([
        db.select().from(eventRoles).where(inArray(eventRoles.eventId, eventIds)),
        db.select().from(eventRsvps).where(inArray(eventRsvps.eventId, eventIds)),
      ])
    : [[], []];
  const assignees = roles.length
    ? await db
        .select()
        .from(eventRoleAssignees)
        .where(
          inArray(
            eventRoleAssignees.roleId,
            roles.map((r) => r.id),
          ),
        )
    : [];

  // Per meeting.
  const byMeeting = new Map<number, Record<string, number>>();
  for (const k of marks) {
    const c = byMeeting.get(k.meetingId) ?? { present: 0, late: 0, absent: 0, excused: 0 };
    c[k.status] = (c[k.status] ?? 0) + 1;
    byMeeting.set(k.meetingId, c);
  }
  const names = new Map(members.map(({ u }) => [u.id, displayName(u)]));
  const meetingRows = held.map((m) => {
    const c = byMeeting.get(m.id) ?? { present: 0, late: 0, absent: 0, excused: 0 };
    const came = c.present! + c.late!;
    return {
      id: m.id,
      title: m.title,
      startsAt: m.startsAt,
      kind: m.kind,
      topic: m.topic,
      leaderName: m.leaderUserId ? (names.get(m.leaderUserId) ?? null) : null,
      present: c.present!,
      late: c.late!,
      absent: c.absent!,
      excused: c.excused!,
      guests: m.guestCount,
      rate: pct(came, came + c.absent!),
    };
  });
  const series: AttendancePoint[] = meetingRows.map((m) => ({
    meetingId: m.id,
    startsAt: m.startsAt,
    title: m.title,
    attended: m.present + m.late,
    total: m.present + m.late + m.absent,
  }));

  // By kind of meeting.
  const kinds = new Map<string | null, { meetings: number; came: number; total: number }>();
  for (const m of meetingRows) {
    const k = kinds.get(m.kind) ?? { meetings: 0, came: 0, total: 0 };
    k.meetings++;
    k.came += m.present + m.late;
    k.total += m.present + m.late + m.absent;
    kinds.set(m.kind, k);
  }

  // Per person: current members and anyone marked in the period.
  const marked = new Set(marks.map((k) => k.userId));
  const newestFirst = [...held].reverse();
  const statusOf = new Map(marks.map((k) => [`${k.meetingId}:${k.userId}`, k.status]));
  const dutiesOf = new Map<number, number>();
  for (const a of assignees) dutiesOf.set(a.userId, (dutiesOf.get(a.userId) ?? 0) + 1);
  for (const r of roles)
    if (r.leaderUserId && !assignees.some((a) => a.roleId === r.id && a.userId === r.leaderUserId))
      dutiesOf.set(r.leaderUserId, (dutiesOf.get(r.leaderUserId) ?? 0) + 1);
  const people: StatPerson[] = members
    .filter(({ m, u }) => m.status === 'active' || marked.has(u.id))
    .map(({ m, u, positionName }) => {
      const mine = marks.filter((k) => k.userId === u.id);
      const count = (s: string) => mine.filter((k) => k.status === s).length;
      const present = count('present');
      const late = count('late');
      const absent = count('absent');
      let streak = 0;
      for (const meeting of newestFirst) {
        const s = statusOf.get(`${meeting.id}:${u.id}`);
        if (!s || s === 'excused') continue;
        if (s !== 'absent') break;
        streak++;
      }
      const seen = newestFirst.find((meeting) => {
        const s = statusOf.get(`${meeting.id}:${u.id}`);
        return s === 'present' || s === 'late';
      });
      return {
        userId: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        positionName,
        role: m.status === 'active' ? m.role : null,
        isAdmin: u.isAdmin,
        active: m.status === 'active',
        joinedAt: m.joinedAt,
        present,
        late,
        absent,
        excused: count('excused'),
        counted: present + late + absent,
        percent: pct(present + late, present + late + absent),
        streak,
        lastSeen: seen?.startsAt ?? null,
        led: held.filter((x) => x.leaderUserId === u.id).length,
        snacks: held.filter((x) => x.snackUserId === u.id).length,
        duties: dutiesOf.get(u.id) ?? 0,
      };
    })
    .sort(
      (a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.firstName.localeCompare(b.firstName),
    );

  const activePeople = people.filter((p) => p.active);
  const came = series.reduce((s, p) => s + p.attended, 0);
  const total = series.reduce((s, p) => s + p.total, 0);
  const guests = held.reduce((s, m) => s + m.guestCount, 0);
  const inRange = (d: string | null) =>
    d !== null && d.slice(0, 10) >= period.from && d.slice(0, 10) <= period.to;

  return {
    groupName: group.name,
    from: period.from,
    to: period.to,
    summary: {
      activeMembers: activePeople.length,
      newMembers: members.filter(({ m }) => m.status === 'active' && inRange(m.joinedAt)).length,
      leftMembers: members.filter(({ m }) => m.status === 'left' && inRange(m.leftAt)).length,
      meetingsHeld: held.length,
      meetingsCancelled: cancelled.length,
      averageRate: pct(came, total),
      averagePeople: held.length ? Math.round(((came + guests) / held.length) * 10) / 10 : null,
      guests,
      late: marks.filter((k) => k.status === 'late').length,
      excused: marks.filter((k) => k.status === 'excused').length,
      events: evs.length,
      dutySlots: roles.reduce((s, r) => s + r.slots, 0),
      dutiesFilled: assignees.length,
      faithful: activePeople.filter((p) => p.percent !== null && p.percent >= 80).length,
      atRisk: activePeople.filter((p) => p.streak >= 3).length,
    },
    series,
    kinds: [...kinds.entries()].map(([kind, k]) => ({
      kind,
      meetings: k.meetings,
      averageRate: pct(k.came, k.total),
    })),
    people,
    meetings: meetingRows,
    events: evs.map((e) => {
      const mine = roles.filter((r) => r.eventId === e.id);
      const rs = rsvps.filter((r) => r.eventId === e.id);
      return {
        id: e.id,
        title: e.title,
        startsAt: e.startsAt,
        going: rs.filter((r) => r.status === 'going').length,
        notGoing: rs.filter((r) => r.status === 'not_going').length,
        roles: mine.length,
        slots: mine.reduce((s, r) => s + r.slots, 0),
        filled: assignees.filter((a) => mine.some((r) => r.id === a.roleId)).length,
      };
    }),
  };
}
