import { countedIn, meetingCounts } from './statsRule';
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
  type MeetingRepeat,
  type RollEntry,
  type Speaker,
  readPostDesign,
  readSpeakerLook,
  readSpeakers,
  readTunes,
  type MotionTune,
  type MotionTunes,
  type SpeakerLook,
  repeatSchema,
  meetingServicesSchema,
  DEFAULT_MEETING_REMINDERS,
  MEETING_MOTIONS,
  type MeetingMotion,
  peopleLookSchema,
  type MeetingService,
  type MeetingHelper,
  type PeopleLook,
} from '@church/shared';
import type { Db } from '../db/client';
import {
  attendance,
  groups,
  meetingAudience,
  meetingHelpers,
  meetingSchedules,
  meetings,
  designTemplates,
  memberships,
  users,
  type Meeting,
} from '../db/schema';
import { lookSources, posterLook } from './looks';
import { posterTemplatesById } from './posterTemplates';
import { signedMediaUrl } from './media';

const emptyCounts = (): Record<AttendanceStatus, number> => ({
  present: 0,
  late: 0,
  excused: 0,
  absent: 0,
});

// ---------- helpers ----------

/** The helpers of several meetings at once (speakers first, then in the order added). */
export async function helpersOf(
  db: Db,
  meetingIds: number[],
  secret?: string,
): Promise<Map<number, MeetingHelper[]>> {
  const out = new Map<number, MeetingHelper[]>();
  if (meetingIds.length === 0) return out;
  const rows = [];
  for (let i = 0; i < meetingIds.length; i += 90)
    rows.push(
      ...(await db
        .select()
        .from(meetingHelpers)
        .where(inArray(meetingHelpers.meetingId, meetingIds.slice(i, i + 90)))
        .orderBy(desc(meetingHelpers.speaker), asc(meetingHelpers.id))),
    );
  const people = await meetingPeople(
    db,
    rows.map((r) => r.userId),
    secret,
  );
  for (const r of rows) {
    const person = people.get(r.userId);
    if (!person) continue;
    out.set(r.meetingId, [
      ...(out.get(r.meetingId) ?? []),
      {
        id: r.id,
        role: r.role,
        icon: r.icon ?? (r.speaker ? '🎤' : null),
        speaker: r.speaker,
        person,
        notifiedAt: r.notifiedAt,
        acceptedAt: r.acceptedAt,
        declinedAt: r.declinedAt,
      },
    ]);
  }
  return out;
}

// ---------- reminders & motion ----------

/** Minutes before a meeting its reminders go (the ministry's list, else 2 h and 1 h). */
export function readReminders(raw: string | null): number[] {
  if (raw === null) return DEFAULT_MEETING_REMINDERS;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.filter((x): x is number => Number.isInteger(x) && x > 0).sort((a, b) => b - a)
      : DEFAULT_MEETING_REMINDERS;
  } catch {
    return DEFAULT_MEETING_REMINDERS;
  }
}

export const readMotion = (v: string | null): MeetingMotion | null =>
  (MEETING_MOTIONS as readonly string[]).includes(v ?? '') ? (v as MeetingMotion) : null;

// ---------- services & people look ----------

/** The ministry's saved services, read defensively. */
export function readServices(raw: string | null): MeetingService[] {
  if (!raw) return [];
  try {
    const r = meetingServicesSchema.safeParse({ services: JSON.parse(raw) });
    return r.success ? r.data.services : [];
  } catch {
    return [];
  }
}

async function readPeopleLook(raw: string | null, secret?: string): Promise<PeopleLook | null> {
  if (!raw) return null;
  try {
    const r = peopleLookSchema.safeParse(JSON.parse(raw));
    if (!r.success) return null;
    return {
      ...r.data,
      photoUrl:
        r.data.photoMediaId && secret ? await signedMediaUrl(secret, r.data.photoMediaId) : null,
    };
  } catch {
    return null;
  }
}

// ---------- repeating meetings ----------

export const readRepeat = (raw: string | null): MeetingRepeat | null => {
  if (!raw) return null;
  try {
    const r = repeatSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
};

/** Local dates of a repeating meeting: the first, then every week / two weeks / month. */
export function repeatDates(first: string, repeat: MeetingRepeat): string[] {
  const out: string[] = [];
  const [y, m, d] = first.split('-').map(Number) as [number, number, number];
  for (let i = 0; i < repeat.count; i++) {
    if (repeat.every === 'monthly') {
      const total = m - 1 + i;
      const year = y + Math.floor(total / 12);
      const month = total % 12;
      // The same day number, or the month's last day when it is shorter.
      const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      out.push(
        `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`,
      );
    } else {
      out.push(addDays(first, i * (repeat.every === 'weekly' ? 7 : 14)));
    }
  }
  return out;
}

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
            counts: schedule.counts,
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

/** Settings per animation, field by field: `own` over `base` (each kind merged). */
export function mergeTunes(base: MotionTunes, own: MotionTunes): MotionTunes {
  const out: MotionTunes = { ...base };
  for (const [k, v] of Object.entries(own) as [keyof MotionTunes, MotionTune][])
    out[k] = { ...base[k], ...v };
  return out;
}

/** Speaker-photo looks merged field by field, later ones winning; null when none is set. */
export function mergeLooks(...looks: (SpeakerLook | null | undefined)[]): SpeakerLook | null {
  const set = looks.filter((l): l is SpeakerLook => !!l);
  return set.length ? Object.assign({}, ...set) : null;
}

/**
 * Speakers with their photo links; `secret` signs them (without it `photoUrl` stays null).
 * A speaker picked from the members without an own photo shows their profile photo.
 */
export async function speakersOf(db: Db, raw: string | null, secret?: string): Promise<Speaker[]> {
  const list = readSpeakers(raw);
  const ids = list.filter((sp) => !sp.mediaId && sp.userId).map((sp) => sp.userId!);
  const profile = new Map(
    ids.length
      ? (
          await db
            .select({ id: users.id, photo: users.photoMediaId })
            .from(users)
            .where(inArray(users.id, ids))
        ).map((u) => [u.id, u.photo])
      : [],
  );
  return Promise.all(
    list.map(async (sp) => {
      const photo = sp.mediaId ?? (sp.userId ? profile.get(sp.userId) : null) ?? null;
      return { ...sp, photoUrl: photo && secret ? await signedMediaUrl(secret, photo) : null };
    }),
  );
}

/** Meeting rows for the app; pass the signing `secret` to include speaker photo links. */
export async function toMeetingRows(
  db: Db,
  list: Meeting[],
  secret?: string,
): Promise<MeetingRow[]> {
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
  const [people, audience] = await Promise.all([
    meetingPeople(
      db,
      list.flatMap((m) => [m.leaderUserId, m.snackUserId, m.leaderDeclinedBy, m.snackDeclinedBy]),
      secret,
    ),
    audienceOf(
      db,
      list.map((m) => m.id),
    ),
  ]);
  const speakers = await Promise.all(list.map((m) => speakersOf(db, m.speakers, secret)));
  // A meeting without a look of its own wears its ministry's default design template
  // (Design tab), so looks come from the templates and one meeting can still differ.
  const groupIds = [...new Set(list.map((m) => m.groupId))];
  const groupRows = groupIds.length
    ? await db
        .select({
          id: groups.id,
          motion: groups.meetingMotion,
          template: groups.meetingTemplateId,
          speakerLook: groups.speakerLook,
          statKinds: groups.statKinds,
        })
        .from(groups)
        .where(inArray(groups.id, groupIds))
    : [];
  const statRules = new Map(groupRows.map((g) => [g.id, g.statKinds]));
  const motions = new Map(groupRows.map((g) => [g.id, readMotion(g.motion)]));
  const defaults = new Map(groupRows.map((g) => [g.id, g.template]));
  const groupSpeakerLooks = new Map(groupRows.map((g) => [g.id, readSpeakerLook(g.speakerLook)]));
  // Only an own look (own pattern / photo) leaves the default; own fonts, title size or
  // speaker photos on top of it don't.
  const tplOf = list.map(
    (m) =>
      m.templateId ?? (readPostDesign(m.design)?.custom ? null : defaults.get(m.groupId)) ?? null,
  );
  const { brandOf, templateOf } = secret
    ? await lookSources(
        db,
        list.map((m) => m.groupId),
        tplOf,
      )
    : { brandOf: new Map(), templateOf: new Map() };
  const helpers = await helpersOf(
    db,
    list.map((m) => m.id),
    secret,
  );
  // A template's animation sits between the meeting's own and the ministry's.
  const templateIds = [...new Set(tplOf.filter((x): x is number => !!x))];
  const templateMotions = new Map(
    templateIds.length
      ? (
          await db
            .select({
              id: designTemplates.id,
              motion: designTemplates.motion,
              tile: designTemplates.tileMotion,
              poster: designTemplates.posterMotion,
              tunes: designTemplates.motionTunes,
              speakerLook: designTemplates.speakerLook,
            })
            .from(designTemplates)
            .where(inArray(designTemplates.id, templateIds))
        ).map((t) => [
          t.id,
          {
            motion: readMotion(t.motion),
            tile: readMotion(t.tile),
            poster: readMotion(t.poster),
            tunes: readTunes(t.tunes),
            speakerLook: readSpeakerLook(t.speakerLook),
          },
        ])
      : [],
  );
  const peopleLooks = await Promise.all(list.map((m) => readPeopleLook(m.peopleLook, secret)));
  const posters = secret
    ? await posterTemplatesById(
        db,
        list.map((m) => m.posterTemplateId),
        secret,
      )
    : new Map();
  const looks = await Promise.all(
    list.map(async (m, i) => {
      const brand = brandOf.get(m.groupId);
      return secret && brand
        ? posterLook(
            secret,
            brand,
            readPostDesign(m.design),
            tplOf[i] ? templateOf.get(tplOf[i]!) : undefined,
          )
        : null;
    }),
  );
  return list.map((m, i) => ({
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
    statChoice: m.counts,
    countsInStats: meetingCounts(m, statRules.get(m.groupId)),
    leader: (m.leaderUserId && people.get(m.leaderUserId)) || null,
    snackPerson: (m.snackUserId && people.get(m.snackUserId)) || null,
    budgetCents: m.budgetCents,
    audience: audience.get(m.id) ?? null,
    leaderNotifiedAt: m.leaderNotifiedAt,
    snackNotifiedAt: m.snackNotifiedAt,
    leaderAcceptedAt: m.leaderAcceptedAt,
    snackAcceptedAt: m.snackAcceptedAt,
    leaderDeclined:
      (!m.leaderUserId && m.leaderDeclinedBy && people.get(m.leaderDeclinedBy)) || null,
    peopleLook: peopleLooks[i]!,
    helpers: helpers.get(m.id) ?? [],
    motion:
      readMotion(m.motion) ??
      (tplOf[i] ? templateMotions.get(tplOf[i]!)?.motion : null) ??
      motions.get(m.groupId) ??
      'calm',
    ownMotion: readMotion(m.motion),
    tileMotion:
      readMotion(m.tileMotion) ?? (tplOf[i] ? templateMotions.get(tplOf[i]!)?.tile : null) ?? null,
    ownTileMotion: readMotion(m.tileMotion),
    posterMotion:
      readMotion(m.posterMotion) ??
      (tplOf[i] ? templateMotions.get(tplOf[i]!)?.poster : null) ??
      null,
    ownPosterMotion: readMotion(m.posterMotion),
    // Settings field by field: the meeting's own changes over its template's.
    motionTunes: mergeTunes(
      (tplOf[i] ? templateMotions.get(tplOf[i]!)?.tunes : null) ?? {},
      readTunes(m.motionTunes),
    ),
    ownMotionTunes: readTunes(m.motionTunes),
    // Field by field too: own changes over the template's over the ministry's.
    speakerLook: mergeLooks(
      groupSpeakerLooks.get(m.groupId),
      tplOf[i] ? templateMotions.get(tplOf[i]!)?.speakerLook : null,
      readPostDesign(m.design)?.speakerLook,
    ),
    posterTemplateId: m.posterTemplateId,
    poster: (m.posterTemplateId && posters.get(m.posterTemplateId)) || null,
    snackDeclined: (!m.snackUserId && m.snackDeclinedBy && people.get(m.snackDeclinedBy)) || null,
    counts: counts.get(m.id) ?? emptyCounts(),
    design: readPostDesign(m.design),
    templateId: tplOf[i] ?? null,
    ownTemplateId: m.templateId,
    lookVersion: m.lookVersion,
    look: looks[i]!,
    speakers: speakers[i]!,
    seriesId: m.seriesId,
    repeat: readRepeat(m.repeatRule),
  }));
}

/** Who each meeting is for (only meetings that aren't for everyone appear). */
export async function audienceOf(db: Db, meetingIds: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  for (let i = 0; i < meetingIds.length; i += 90) {
    const rows = await db
      .select()
      .from(meetingAudience)
      .where(inArray(meetingAudience.meetingId, meetingIds.slice(i, i + 90)));
    for (const r of rows) out.set(r.meetingId, [...(out.get(r.meetingId) ?? []), r.userId]);
  }
  return out;
}

/** Whether a person may see a meeting (it's for everyone, or they are on its list). */
export const meetingIsFor = (audience: Map<number, number[]>, meetingId: number, userId: number) =>
  !audience.has(meetingId) || audience.get(meetingId)!.includes(userId);

export const meetingKind = (v: string | null): MeetingKind | null =>
  (MEETING_KINDS as readonly string[]).includes(v ?? '') ? (v as MeetingKind) : null;

/** Name and username of the people a set of meetings refers to. */
export async function meetingPeople(
  db: Db,
  ids: (number | null)[],
  /** Signs photo links; without it `photoUrl` stays null. */
  secret?: string,
): Promise<Map<number, MeetingPerson>> {
  const unique = [...new Set(ids.filter((x): x is number => x !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      photoMediaId: users.photoMediaId,
    })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(
    await Promise.all(
      rows.map(
        async ({ photoMediaId, ...r }) =>
          [
            r.id,
            {
              ...r,
              photoUrl: photoMediaId && secret ? await signedMediaUrl(secret, photoMediaId) : null,
            },
          ] as const,
      ),
    ),
  );
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

  // A meeting for chosen people has only them on its roll call.
  const chosen = (await audienceOf(db, [meeting.id])).get(meeting.id);
  const eligible = new Map<number, typeof users.$inferSelect>();
  for (const { u, joinedAt } of members) {
    if (chosen && !chosen.includes(u.id)) continue;
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
  const counted = await countedIn(db, groupId);
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
      .where(and(eq(meetings.groupId, groupId), eq(meetings.status, 'done'), counted))
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
): Promise<Omit<MemberAttendance, 'visible'>> {
  const { userId, groupId, groupName, joinedAt, timezone } = args;
  const now = args.now ?? new Date();
  const joinedDay = joinedAt ? dayStart(joinedAt, timezone) : null;

  // Only meetings that count in statistics (optional ones don't change the percentage).
  const held = await db
    .select({ id: meetings.id, startsAt: meetings.startsAt })
    .from(meetings)
    .where(
      and(eq(meetings.groupId, groupId), eq(meetings.status, 'done'), await countedIn(db, groupId)),
    )
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
  // Meetings for other chosen people don't count.
  const heldAudience = await audienceOf(db, ids);
  const timeline = held
    .filter((m) => marks.has(m.id) || meetingIsFor(heldAudience, m.id, userId))
    .filter((m) => marks.has(m.id) || !joinedDay || m.startsAt >= joinedDay)
    .map((m) => ({
      meetingId: m.id,
      startsAt: m.startsAt,
      status: (marks.get(m.id) ?? 'absent') as AttendanceStatus,
    }));
  const statuses = timeline.map((t) => t.status);
  const rate = attendanceRate(statuses);

  const coming = await db
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
    .limit(10);
  // The next meeting this person is invited to.
  const comingAudience = await audienceOf(
    db,
    coming.map((m) => m.id),
  );
  const next = coming.filter((m) => meetingIsFor(comingAudience, m.id, userId)).slice(0, 1);

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
