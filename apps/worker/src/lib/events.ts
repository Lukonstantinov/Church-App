import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  zonedToUtc,
  readPostDesign,
  motionTuneSchema,
  motionLayersSchema,
  coverSlidesSchema,
  type MotionLayer,
  type EventDetail,
  type EventFinance,
  type EventProgramItem,
  type EventRole,
  type EventSummary,
  type PersonRef,
  type RoleInput,
  type RsvpStatus,
  type MotionTune,
} from '@church/shared';
import type { Db } from '../db/client';
import {
  eventPhotos,
  eventRoleAssignees,
  eventProgram,
  eventRoles,
  eventRsvps,
  events,
  groups,
  memberships,
  transactions,
  users,
  type EventRow,
  type User,
} from '../db/schema';
import { accessIn, can, designRights } from './access';
import { posterLook, lookSources } from './looks';
import { signedMediaUrl } from './media';
import { readMotion, speakersOf } from './meetings';
import { toTransactionRows } from './treasury';

const DAY = 86_400_000;

/** Start/end instants from local date+time fields (end defaults to none). */
export function eventTimes(
  input: { date: string; startTime: string; endDate?: string | null; endTime?: string | null },
  tz: string,
): { startsAt: string; endsAt: string | null } {
  const start = zonedToUtc(input.date, input.startTime, tz);
  let endsAt: string | null = null;
  if (input.endTime || input.endDate) {
    const end = zonedToUtc(input.endDate ?? input.date, input.endTime ?? input.startTime, tz);
    if (end.getTime() <= start.getTime())
      throw new HTTPException(400, { message: 'end_before_start' });
    endsAt = end.toISOString();
  }
  return { startsAt: start.toISOString(), endsAt };
}

export async function loadEventOr404(db: Db, id: number): Promise<EventRow> {
  const row = await db.query.events.findFirst({ where: eq(events.id, id) });
  if (!row) throw new HTTPException(404, { message: 'event_not_found' });
  return row;
}

/** Members of the event's group (and admins) may view; leaders/admins manage. */
export async function eventAccess(db: Db, user: User, event: EventRow) {
  const a = await accessIn(db, user, event.groupId);
  // Pinned events are shown to the whole church on the main page.
  if (!a.member && !event.pinnedAt) throw new HTTPException(404, { message: 'event_not_found' });
  return { canManage: a.perms.has('events.manage'), member: a.member };
}

async function peopleIn(db: Db, groupId: number, userIds: number[]): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.status, 'active'),
        inArray(memberships.userId, userIds),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/** The programme in order: by day, then time. */
export async function loadProgram(db: Db, eventId: number): Promise<EventProgramItem[]> {
  const rows = await db
    .select({
      p: eventProgram,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(eventProgram)
    .leftJoin(users, eq(users.id, eventProgram.userId))
    .where(eq(eventProgram.eventId, eventId))
    .orderBy(asc(eventProgram.day), asc(eventProgram.time), asc(eventProgram.sort));
  return rows.map(({ p, firstName, lastName }) => ({
    id: p.id,
    day: p.day,
    time: p.time,
    title: p.title,
    person: p.userId ? { id: p.userId, firstName: firstName ?? '', lastName } : null,
    note: p.note,
  }));
}

/** Replaces the programme; the people named must be members of the event's ministry. */
export async function setProgram(
  db: Db,
  event: EventRow,
  items: {
    day?: number;
    time: string;
    title: string;
    userId?: number | null;
    note?: string | null;
  }[],
): Promise<void> {
  const ids = [...new Set(items.map((i) => i.userId).filter((x): x is number => !!x))];
  const allowed = await peopleIn(db, event.groupId, ids);
  if (ids.some((u) => !allowed.has(u))) throw new HTTPException(400, { message: 'not_a_member' });
  await db.delete(eventProgram).where(eq(eventProgram.eventId, event.id));
  if (items.length)
    await db.insert(eventProgram).values(
      items.map((i, sort) => ({
        eventId: event.id,
        day: i.day ?? 0,
        time: i.time,
        title: i.title,
        userId: i.userId ?? null,
        note: i.note ?? null,
        sort,
      })),
    );
}

/** Someone given a duty they didn't have before. */
export interface DutyAdded {
  userId: number;
  roleName: string;
  description: string | null;
}

/**
 * Replaces the event's duty list; roles keep their id (and people) when passed back.
 * Returns who was newly given which duty, so they can be told.
 */
export async function setRoles(db: Db, event: EventRow, roles: RoleInput[]): Promise<DutyAdded[]> {
  const allUsers = [...new Set(roles.flatMap((r) => r.userIds ?? []))];
  const allowed = await peopleIn(db, event.groupId, allUsers);
  if (allUsers.some((u) => !allowed.has(u)))
    throw new HTTPException(400, { message: 'not_a_member' });

  const existing = await db
    .select({ id: eventRoles.id })
    .from(eventRoles)
    .where(eq(eventRoles.eventId, event.id));
  const existingIds = new Set(existing.map((r) => r.id));
  const before = existingIds.size
    ? await db
        .select({ roleId: eventRoleAssignees.roleId, userId: eventRoleAssignees.userId })
        .from(eventRoleAssignees)
        .where(inArray(eventRoleAssignees.roleId, [...existingIds]))
    : [];
  const had = new Set(before.map((a) => `${a.roleId}:${a.userId}`));
  const added: DutyAdded[] = [];
  const keep = new Set(
    roles.map((r) => r.id).filter((id): id is number => !!id && existingIds.has(id)),
  );
  const drop = [...existingIds].filter((id) => !keep.has(id));
  if (drop.length) {
    await db.delete(eventRoleAssignees).where(inArray(eventRoleAssignees.roleId, drop));
    await db.delete(eventRoles).where(inArray(eventRoles.id, drop));
  }

  for (const [sort, r] of roles.entries()) {
    let roleId: number;
    if (r.id && keep.has(r.id)) {
      roleId = r.id;
      await db
        .update(eventRoles)
        .set({
          name: r.name,
          description: r.description ?? null,
          leaderUserId: r.leaderId && (r.userIds ?? []).includes(r.leaderId) ? r.leaderId : null,
          slots: r.slots ?? 1,
          sort,
        })
        .where(eq(eventRoles.id, roleId));
      await db.delete(eventRoleAssignees).where(eq(eventRoleAssignees.roleId, roleId));
    } else {
      const [row] = await db
        .insert(eventRoles)
        .values({
          eventId: event.id,
          name: r.name,
          description: r.description ?? null,
          leaderUserId: r.leaderId && (r.userIds ?? []).includes(r.leaderId) ? r.leaderId : null,
          slots: r.slots ?? 1,
          sort,
        })
        .returning({ id: eventRoles.id });
      roleId = row!.id;
    }
    const ids = [...new Set(r.userIds ?? [])];
    if (ids.length) {
      await db.insert(eventRoleAssignees).values(ids.map((userId) => ({ roleId, userId })));
      for (const userId of ids)
        if (!had.has(`${roleId}:${userId}`))
          added.push({ userId, roleName: r.name, description: r.description ?? null });
    }
  }
  return added;
}

export async function setRsvp(
  db: Db,
  event: EventRow,
  userId: number,
  status: RsvpStatus | null,
): Promise<void> {
  if (!(await peopleIn(db, event.groupId, [userId])).has(userId)) {
    throw new HTTPException(400, { message: 'not_a_member' });
  }
  if (status === null) {
    await db
      .delete(eventRsvps)
      .where(and(eq(eventRsvps.eventId, event.id), eq(eventRsvps.userId, userId)));
    return;
  }
  await db
    .insert(eventRsvps)
    .values({ eventId: event.id, userId, status, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: [eventRsvps.eventId, eventRsvps.userId],
      set: { status, updatedAt: new Date().toISOString() },
    });
}

const features = (e: EventRow) => ({
  gallery: e.hasGallery,
  rsvp: e.hasRsvp,
  duties: e.hasDuties,
  cost: e.hasCost,
});

/** An event's saved animation settings, read defensively (bad JSON = as designed). */
function readTune(raw: string | null): MotionTune | null {
  if (!raw) return null;
  try {
    const parsed = motionTuneSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** An event's cover slideshow with signed links to its photos, read defensively. */
async function readSlides(
  raw: string | null,
  secret: string,
): Promise<EventSummary['coverSlides']> {
  if (!raw) return null;
  try {
    const parsed = coverSlidesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.mediaIds.length === 0) return null;
    const { mediaIds, seconds } = parsed.data;
    return {
      mediaIds,
      seconds,
      urls: await Promise.all(mediaIds.map((id) => signedMediaUrl(secret, id))),
    };
  } catch {
    return null;
  }
}

/** An event's extra cover effects, read defensively. */
function readLayers(raw: string | null): MotionLayer[] {
  if (!raw) return [];
  try {
    const parsed = motionLayersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Summaries for a list of events, from the viewpoint of `userId`. */
async function summarize(
  db: Db,
  secret: string,
  rows: (EventRow & { groupName: string; groupBrand?: string | null })[],
  userId: number,
): Promise<EventSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [going, mine, myRoles] = await Promise.all([
    db
      .select({ eventId: eventRsvps.eventId, n: sql<number>`count(*)` })
      .from(eventRsvps)
      .where(and(inArray(eventRsvps.eventId, ids), eq(eventRsvps.status, 'going')))
      .groupBy(eventRsvps.eventId),
    db
      .select({ eventId: eventRsvps.eventId, status: eventRsvps.status })
      .from(eventRsvps)
      .where(and(inArray(eventRsvps.eventId, ids), eq(eventRsvps.userId, userId))),
    db
      .select({
        eventId: eventRoles.eventId,
        name: eventRoles.name,
        description: eventRoles.description,
      })
      .from(eventRoleAssignees)
      .innerJoin(eventRoles, eq(eventRoles.id, eventRoleAssignees.roleId))
      .where(and(inArray(eventRoles.eventId, ids), eq(eventRoleAssignees.userId, userId)))
      .orderBy(asc(eventRoles.sort)),
  ]);
  const goingBy = new Map(going.map((g) => [g.eventId, Number(g.n)]));
  const mineBy = new Map(mine.map((m) => [m.eventId, m.status]));
  const { brandOf, templateOf } = await lookSources(
    db,
    rows.map((r) => r.groupId),
    rows.map((r) => r.templateId),
  );
  return Promise.all(
    rows.map(async (e) => {
      const design = readPostDesign(e.design);
      const brand = brandOf.get(e.groupId);
      const tpl = e.templateId ? templateOf.get(e.templateId) : undefined;
      return {
        id: e.id,
        groupId: e.groupId,
        groupName: e.groupName,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        location: e.location,
        coverUrl: e.coverMediaId ? await signedMediaUrl(secret, e.coverMediaId) : null,
        features: features(e),
        priceCents: e.priceCents,
        status: e.status,
        goingCount: goingBy.get(e.id) ?? 0,
        pinned: e.pinnedAt !== null,
        brandColor: e.groupBrand ?? null,
        myRsvp: mineBy.get(e.id) ?? null,
        myRoles: myRoles.filter((r) => r.eventId === e.id).map((r) => r.name),
        myDuties: myRoles
          .filter((r) => r.eventId === e.id)
          .map((r) => ({ name: r.name, description: r.description })),
        design,
        templateId: e.templateId,
        motion: readMotion(e.motion),
        motionTune: readTune(e.motionTune),
        motionLayers: readLayers(e.motionLayers),
        coverSlides: await readSlides(e.coverSlides, secret),
        countdown: e.countdown,
        speakers: await speakersOf(e.speakers, secret),
        createdAt: e.createdAt,
        look: brand ? await posterLook(secret, brand, design, tpl) : null,
      };
    }),
  );
}

/** An event counts as upcoming until it ends (or a day after the start without an end). */
const stillOn = (now: string) =>
  or(
    gte(events.endsAt, now),
    and(isNull(events.endsAt), gte(events.startsAt, new Date(Date.parse(now) - DAY).toISOString())),
  );

export async function listEvents(
  db: Db,
  secret: string,
  groupIds: number[],
  userId: number,
  scope: 'upcoming' | 'past',
  limit = 50,
): Promise<EventSummary[]> {
  if (groupIds.length === 0) return [];
  const now = new Date().toISOString();
  const rows = await db
    .select({ event: events, groupName: groups.name, groupBrand: groups.brandColor })
    .from(events)
    .innerJoin(groups, eq(groups.id, events.groupId))
    .where(
      and(
        inArray(events.groupId, groupIds),
        scope === 'upcoming' ? stillOn(now) : sql`not (${stillOn(now)})`,
      ),
    )
    .orderBy(scope === 'upcoming' ? asc(events.startsAt) : desc(events.startsAt))
    .limit(limit);
  return summarize(
    db,
    secret,
    rows.map((r) => ({ ...r.event, groupName: r.groupName, groupBrand: r.groupBrand })),
    userId,
  );
}

const person = (u: { id: number; firstName: string; lastName: string | null }): PersonRef => ({
  id: u.id,
  firstName: u.firstName,
  lastName: u.lastName,
});

export async function eventDetail(
  db: Db,
  secret: string,
  event: EventRow,
  user: User,
): Promise<EventDetail> {
  const canManage = await can(db, user, event.groupId, 'events.manage');
  const rights = await designRights(db, user, event.groupId);
  const group = await db.query.groups.findFirst({
    columns: { name: true, brandColor: true },
    where: eq(groups.id, event.groupId),
  });
  const [summary] = await summarize(
    db,
    secret,
    [{ ...event, groupName: group?.name ?? '', groupBrand: group?.brandColor }],
    user.id,
  );
  const member = (await accessIn(db, user, event.groupId)).member;

  const [members, rsvps, roles, assignees, photos, money] = await Promise.all([
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupId, event.groupId), eq(memberships.status, 'active')))
      .orderBy(users.firstName, users.lastName),
    db.select().from(eventRsvps).where(eq(eventRsvps.eventId, event.id)),
    db
      .select()
      .from(eventRoles)
      .where(eq(eventRoles.eventId, event.id))
      .orderBy(asc(eventRoles.sort), asc(eventRoles.id)),
    db
      .select({
        roleId: eventRoleAssignees.roleId,
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(eventRoleAssignees)
      .innerJoin(eventRoles, eq(eventRoles.id, eventRoleAssignees.roleId))
      .innerJoin(users, eq(users.id, eventRoleAssignees.userId))
      .where(eq(eventRoles.eventId, event.id)),
    db
      .select()
      .from(eventPhotos)
      .where(eq(eventPhotos.eventId, event.id))
      .orderBy(asc(eventPhotos.id)),
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.eventId, event.id), isNull(transactions.voidedAt)))
      .orderBy(desc(transactions.occurredOn), desc(transactions.id)),
  ]);

  const status = new Map(rsvps.map((r) => [r.userId, r.status]));
  const going = members.filter((m) => status.get(m.id) === 'going').map(person);
  const notGoing = members.filter((m) => status.get(m.id) === 'not_going').map(person);
  const noAnswer = canManage ? members.filter((m) => !status.has(m.id)).map(person) : [];

  const roleList: EventRole[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    leader: assignees.find((a) => a.roleId === r.id && a.id === r.leaderUserId)
      ? person(assignees.find((a) => a.roleId === r.id && a.id === r.leaderUserId)!)
      : null,
    slots: r.slots,
    assignees: assignees.filter((a) => a.roleId === r.id).map(person),
  }));

  const paidBy = new Map<number, number>();
  for (const tx of money) {
    if (tx.kind === 'event_payment' && tx.memberUserId) {
      paidBy.set(tx.memberUserId, (paidBy.get(tx.memberUserId) ?? 0) + tx.amountCents);
    }
  }

  let finance: EventFinance | null = null;
  if (canManage && event.hasCost) {
    const rows = await toTransactionRows(db, secret, money);
    const byId = new Map(members.map((m) => [m.id, m]));
    const involved = [...new Set([...going.map((g) => g.id), ...paidBy.keys()])];
    finance = {
      priceCents: event.priceCents,
      collectedCents: money
        .filter((t) => t.kind !== 'event_expense' && t.kind !== 'expense')
        .reduce((s, t) => s + t.amountCents, 0),
      expenseCents: money
        .filter((t) => t.kind === 'event_expense' || t.kind === 'expense')
        .reduce((s, t) => s + t.amountCents, 0),
      people: involved
        .map((id) => {
          const m = byId.get(id) ?? rows.find((r) => r.member?.id === id)?.member;
          return m
            ? {
                member: person(m),
                paidCents: paidBy.get(id) ?? 0,
                going: status.get(id) === 'going',
              }
            : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .sort((a, b) => a.member.firstName.localeCompare(b.member.firstName)),
      payments: rows.filter((r) => r.kind === 'event_payment'),
      expenses: rows.filter((r) => r.kind === 'event_expense'),
    };
  }

  return {
    ...summary!,
    description: event.description,
    chatUrl: event.chatUrl,
    managedChat: event.tgChatId
      ? { title: event.tgChatTitle, pending: event.chatLinkCode !== null }
      : null,
    coverMediaId: event.coverMediaId,
    posterMediaId: event.posterMediaId,
    botPictureUrl:
      (event.posterMediaId ?? event.coverMediaId)
        ? await signedMediaUrl(secret, (event.posterMediaId ?? event.coverMediaId)!)
        : null,
    photos: await Promise.all(
      photos.map(async (p) => ({ id: p.id, url: await signedMediaUrl(secret, p.mediaId) })),
    ),
    rsvps: event.hasRsvp
      ? { going, notGoing, noAnswer }
      : { going: [], notGoing: [], noAnswer: [] },
    roles: event.hasDuties ? roleList : [],
    program: await loadProgram(db, event.id),
    finance,
    myPaidCents: paidBy.get(user.id) ?? 0,
    canManage,
    canDesign: rights.designer || (!rights.locked && canManage),
    member,
  };
}

/** Upcoming pinned events of every (non-archived) ministry, for the main page. */
export async function listPinned(db: Db, secret: string, userId: number) {
  const now = new Date().toISOString();
  const rows = await db
    .select({ event: events, groupName: groups.name, groupBrand: groups.brandColor })
    .from(events)
    .innerJoin(groups, eq(groups.id, events.groupId))
    .where(
      and(
        isNotNull(events.pinnedAt),
        isNull(groups.archivedAt),
        eq(events.status, 'scheduled'),
        stillOn(now),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(10);
  return summarize(
    db,
    secret,
    rows.map((r) => ({ ...r.event, groupName: r.groupName, groupBrand: r.groupBrand })),
    userId,
  );
}
