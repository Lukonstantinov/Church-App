import { audienceOf, meetingIsFor, readMotion, readReminders, readServices } from '../lib/meetings';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  ENTER_ANIMATIONS,
  PERMISSIONS,
  MINISTRY_PALETTE,
  readBackdrop,
  readPattern,
  readSpeakerLook,
  type EnterAnimation,
  addExistingMemberSchema,
  addOfflineMemberSchema,
  normalizePermissions,
  type Permission,
  type PersonSearchRow,
  createGroupSchema,
  displayName,
  updateGroupSchema,
  type GroupDetail,
  type GroupRole,
  type GroupSummary,
  type MemberRow,
  type ContactRow,
  type LiveItem,
  readScreenLook,
  ministryStudioSchema,
  type ScreenLook,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import type { Db } from '../db/client';
import {
  attendance,
  designTemplates,
  groupLabels,
  groups,
  memberLabels,
  events,
  meetings,
  memberships,
  positions,
  users,
  type Group,
  type User,
} from '../db/schema';
import { accessIn, assertCan, assertCanViewGroup, can, loadGroupOr404 } from '../lib/access';
import { audit } from '../lib/audit';
import { randomCode } from '../lib/codes';
import { churchDefaultLocale } from '../lib/church';
import { assignMissingColors, freeMinistryColor, groupLogoUrl } from '../lib/groups';
import { markFeedRead, unreadCounts } from '../lib/feed';
import { assertGroupMedia, signedMediaUrl } from '../lib/media';
import { createDefaultPositions, defaultPositionId, permsOf, roleFor } from '../lib/positions';
import { botApi, botUsername, inviteLink } from '../lib/telegram';
import { toLabelRef } from './labels';
import { startChatLink, unlinkChat } from '../lib/chats';
import { idParam, parseBody } from './util';

export const groupRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/**
 * What is going on right now in these ministries: meetings (only those meant for the
 * person, unless they manage meetings) and events (until they end, or 3 hours).
 */
/**
 * Meetings and events going on now (`live`) or starting within two hours (`soon`), per
 * ministry, for the main page. Meetings for chosen people only show to them.
 */
async function liveItems(db: Db, ids: number[], user: User) {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const ahead = new Date(Date.now() + SOON_AHEAD_MS).toISOString();
  const [ms, evs] = await Promise.all([
    db
      .select()
      .from(meetings)
      .where(
        and(
          inArray(meetings.groupId, ids),
          eq(meetings.status, 'scheduled'),
          lte(meetings.startsAt, ahead),
          gte(meetings.endsAt, now),
        ),
      ),
    db
      .select()
      .from(events)
      .where(
        and(
          inArray(events.groupId, ids),
          eq(events.status, 'scheduled'),
          lte(events.startsAt, ahead),
          gte(events.startsAt, since),
        ),
      ),
  ]);
  const audience = await audienceOf(
    db,
    ms.map((m) => m.id),
  );
  const live = new Map<number, LiveItem[]>();
  const soon = new Map<number, LiveItem[]>();
  const add = (groupId: number, item: LiveItem) => {
    const out = item.startsAt <= now ? live : soon;
    out.set(groupId, [...(out.get(groupId) ?? []), item]);
  };
  for (const m of ms) {
    if (
      !meetingIsFor(audience, m.id, user.id) &&
      !(await can(db, user, m.groupId, 'meetings.manage'))
    )
      continue;
    add(m.groupId, {
      kind: 'meeting',
      id: m.id,
      title: m.title,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
    });
  }
  for (const e of evs) {
    const end = e.endsAt ?? new Date(Date.parse(e.startsAt) + 3 * 3_600_000).toISOString();
    if (end < now) continue;
    add(e.groupId, {
      kind: 'event',
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
    });
  }
  for (const list of soon.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { live, soon };
}

/** How long before the start the main page shows the "starting soon" button. */
const SOON_AHEAD_MS = 2 * 3_600_000;

/** Adds signed links to the uploaded icon pictures of a page's parts. */
async function signScreenLook(look: ScreenLook, secret: string): Promise<ScreenLook> {
  const out: ScreenLook = {};
  for (const [key, part] of Object.entries(look) as [
    keyof ScreenLook,
    ScreenLook[keyof ScreenLook],
  ][]) {
    if (!part) continue;
    out[key] = {
      ...part,
      ...(part.icon?.mediaId
        ? { icon: { ...part.icon, url: await signedMediaUrl(secret, part.icon.mediaId) } }
        : {}),
      ...(part.photo
        ? { photo: { ...part.photo, url: await signedMediaUrl(secret, part.photo.mediaId) } }
        : {}),
      ...(part.photo2
        ? { photo2: { ...part.photo2, url: await signedMediaUrl(secret, part.photo2.mediaId) } }
        : {}),
    };
  }
  return out;
}

async function summarize(
  db: Db,
  user: User,
  list: Group[],
  secret: string,
): Promise<GroupSummary[]> {
  if (list.length === 0) return [];
  const ids = list.map((g) => g.id);
  const [counts, leaders, mine, unread] = await Promise.all([
    db
      .select({
        groupId: memberships.groupId,
        active: sql<number>`sum(case when ${memberships.status} = 'active' then 1 else 0 end)`,
        pending: sql<number>`sum(case when ${memberships.status} = 'pending' then 1 else 0 end)`,
      })
      .from(memberships)
      .where(inArray(memberships.groupId, ids))
      .groupBy(memberships.groupId),
    db
      .select({
        groupId: memberships.groupId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          inArray(memberships.groupId, ids),
          eq(memberships.role, 'leader'),
          eq(memberships.status, 'active'),
        ),
      ),
    db
      .select({
        groupId: memberships.groupId,
        role: memberships.role,
        positionName: positions.name,
        permissions: positions.permissions,
      })
      .from(memberships)
      .leftJoin(positions, eq(positions.id, memberships.positionId))
      .where(
        and(
          eq(memberships.userId, user.id),
          inArray(memberships.groupId, ids),
          eq(memberships.status, 'active'),
        ),
      ),
    unreadCounts(db, user.id, ids),
  ]);
  const { live, soon } = await liveItems(db, ids, user);
  const countBy = new Map(counts.map((c) => [c.groupId, c]));
  const mineBy = new Map(mine.map((m) => [m.groupId, m]));
  return Promise.all(
    list.map(async (g) => {
      const m = mineBy.get(g.id);
      const myRole: GroupRole | null = m?.role ?? null;
      const myPermissions: Permission[] = user.isAdmin
        ? [...PERMISSIONS]
        : m?.permissions
          ? normalizePermissions(m.permissions)
          : m?.role === 'leader'
            ? [...PERMISSIONS]
            : [];
      const manages = myPermissions.includes('people.manage');
      const backdrop = readBackdrop(g.backdrop);
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        archived: g.archivedAt !== null,
        activeCount: Number(countBy.get(g.id)?.active ?? 0),
        pendingCount: manages ? Number(countBy.get(g.id)?.pending ?? 0) : 0,
        leaderNames: leaders.filter((l) => l.groupId === g.id).map(displayName),
        myRole,
        myPermissions,
        positionName: m?.positionName ?? null,
        brandColor: g.brandColor ?? MINISTRY_PALETTE[g.id % MINISTRY_PALETTE.length]!,
        pattern: readPattern(g.pattern),
        textColor: g.textColor,
        badgeColor: g.badgeColor,
        logoMediaId: g.logoMediaId,
        unreadPosts: unread.get(g.id)?.posts ?? 0,
        unreadComments: unread.get(g.id)?.comments ?? 0,
        animation: (ENTER_ANIMATIONS as readonly string[]).includes(g.animation)
          ? (g.animation as EnterAnimation)
          : 'rise',
        logoUrl: groupLogoUrl(g),
        backdrop,
        backdropUrl: backdrop ? await signedMediaUrl(secret, backdrop.mediaId) : null,
        pageBackground: g.pageBackground ?? null,
        screenLook: await signScreenLook(readScreenLook(g.screenLook), secret),
        live: live.get(g.id) ?? [],
        soon: soon.get(g.id) ?? [],
      };
    }),
  );
}

/** Admins: all groups (archived with ?archived=1). Others: groups they actively belong to. */
groupRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  let list: Group[];
  if (user.isAdmin) {
    list = await db.query.groups.findMany({
      where: c.req.query('archived') === '1' ? undefined : isNull(groups.archivedAt),
      orderBy: [groups.sort, groups.name],
    });
  } else {
    const rows = await db
      .select({ group: groups })
      .from(memberships)
      .innerJoin(groups, eq(groups.id, memberships.groupId))
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.status, 'active'),
          isNull(groups.archivedAt),
        ),
      )
      .orderBy(groups.sort, groups.name);
    list = rows.map((r) => r.group);
  }
  await assignMissingColors(db, list);
  return c.json(await summarize(db, user, list, c.env.WEBHOOK_SECRET));
});

groupRoutes.post('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!user.isAdmin) throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, createGroupSchema);
  // Each ministry starts in its own colour, different from the others and the church's.
  const brandColor = await freeMinistryColor(db);
  const [group] = await db
    .insert(groups)
    .values({
      name: input.name,
      description: input.description,
      inviteCode: randomCode(10),
      brandColor,
    })
    .returning();
  await createDefaultPositions(db, group!.id, await churchDefaultLocale(db));
  await audit(db, {
    actorUserId: user.id,
    action: 'group_created',
    entity: 'group',
    entityId: group!.id,
    groupId: group!.id,
  });
  return c.json({ id: group!.id }, 201);
});

groupRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanViewGroup(db, user, idParam(c));
  await assignMissingColors(db, [group]);
  const [summary] = await summarize(db, user, [group], c.env.WEBHOOK_SECRET);
  const perms = (await accessIn(db, user, group.id)).perms;
  const detail: GroupDetail = {
    ...summary!,
    canManage: perms.size > 0,
    chatUrl: group.chatUrl,
    defaultLocation: group.defaultLocation,
    eventReminderHours: group.eventReminderHours,
    meetingReminders: readReminders(group.meetingReminders),
    meetingMotion: readMotion(group.meetingMotion) ?? 'calm',
    meetingTemplateId: group.meetingTemplateId,
    speakerLook: readSpeakerLook(group.speakerLook),
    meetingServices: readServices(group.meetingServices),
    managedChat: group.tgChatId
      ? { title: group.tgChatTitle, pending: group.chatLinkCode !== null }
      : null,
    inviteLink: perms.has('people.manage')
      ? inviteLink(await botUsername(c.env), group.inviteCode)
      : null,
  };
  return c.json(detail);
});

groupRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'settings');
  const input = await parseBody(c, updateGroupSchema);
  if (input.logoMediaId) await assertGroupMedia(db, group.id, input.logoMediaId);
  if (input.backdrop) await assertGroupMedia(db, group.id, input.backdrop.mediaId);
  const { pattern, backdrop, meetingReminders, ...rest } = input;
  await db
    .update(groups)
    .set({
      ...rest,
      ...(meetingReminders !== undefined
        ? { meetingReminders: meetingReminders && JSON.stringify(meetingReminders) }
        : {}),
      ...(pattern !== undefined ? { pattern: pattern && JSON.stringify(pattern) } : {}),
      ...(backdrop !== undefined ? { backdrop: backdrop && JSON.stringify(backdrop) } : {}),
    })
    .where(eq(groups.id, group.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'group_updated',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: input,
  });
  return c.json({ ok: true });
});

/**
 * The Design studio saves a ministry page: how its parts look and move, the entrance
 * animation, the meetings' animation and the background. Designers or ministry settings.
 */
groupRoutes.put('/:id/studio', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await loadGroupOr404(db, idParam(c));
  const perms = (await accessIn(db, user, group.id)).perms;
  if (!perms.has('design') && !perms.has('settings'))
    throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, ministryStudioSchema);
  // Uploaded icon pictures must be this ministry's; their links are made when reading.
  for (const part of Object.values(input.screenLook ?? {})) {
    if (part?.icon?.mediaId) await assertGroupMedia(db, group.id, part.icon.mediaId);
    if (part?.icon) part.icon.url = null;
    for (const pic of [part?.photo, part?.photo2]) {
      if (!pic) continue;
      await assertGroupMedia(db, group.id, pic.mediaId);
      pic.url = null;
    }
  }
  const patch: Partial<typeof groups.$inferInsert> = {};
  if (input.screenLook !== undefined) patch.screenLook = input.screenLook;
  if (input.animation !== undefined) patch.animation = input.animation;
  if (input.meetingMotion !== undefined) patch.meetingMotion = input.meetingMotion;
  if (input.pageBackground !== undefined) patch.pageBackground = input.pageBackground;
  if (input.speakerLook !== undefined)
    patch.speakerLook = input.speakerLook ? JSON.stringify(input.speakerLook) : null;
  if (input.meetingTemplateId !== undefined) {
    if (
      input.meetingTemplateId !== null &&
      !(await db.query.designTemplates.findFirst({
        where: eq(designTemplates.id, input.meetingTemplateId),
      }))
    )
      throw new HTTPException(400, { message: 'unknown_template' });
    patch.meetingTemplateId = input.meetingTemplateId;
  }
  if (Object.keys(patch).length > 0)
    await db.update(groups).set(patch).where(eq(groups.id, group.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'group_studio',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: input,
  });
  return c.json({ ok: true });
});

groupRoutes.post('/:id/archive', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!user.isAdmin) throw new HTTPException(403, { message: 'forbidden' });
  const group = await assertCan(db, user, idParam(c), 'settings');
  await db
    .update(groups)
    .set({ archivedAt: new Date().toISOString() })
    .where(eq(groups.id, group.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'group_archived',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
  });
  return c.json({ ok: true });
});

groupRoutes.post('/:id/invite/rotate', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'people.manage');
  const code = randomCode(10);
  await db.update(groups).set({ inviteCode: code }).where(eq(groups.id, group.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'invite_rotated',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
  });
  return c.json({ inviteLink: inviteLink(await botUsername(c.env), code) });
});

/** Members of a group (pending + active; ?status=all adds former members). Leaders/admins only. */
groupRoutes.get('/:id/members', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'people.view');
  const statuses =
    c.req.query('status') === 'all'
      ? (['pending', 'active', 'left', 'rejected'] as const)
      : (['pending', 'active'] as const);
  const rows = await db
    .select({
      m: memberships,
      u: users,
      positionName: positions.name,
      positionLook: positions.look,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(and(eq(memberships.groupId, group.id), inArray(memberships.status, [...statuses])))
    .orderBy(users.firstName, users.lastName);
  // Recent attendance per member: last 8 roll calls of the group (excused don't count).
  const recent = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(eq(meetings.groupId, group.id), eq(meetings.status, 'done')))
    .orderBy(desc(meetings.startsAt))
    .limit(8);
  const rates = new Map<number, { attended: number; counted: number }>();
  if (recent.length > 0) {
    const marks = await db
      .select({ userId: attendance.userId, status: attendance.status })
      .from(attendance)
      .where(
        inArray(
          attendance.meetingId,
          recent.map((r) => r.id),
        ),
      );
    for (const mark of marks) {
      if (mark.status === 'excused') continue;
      const r = rates.get(mark.userId) ?? { attended: 0, counted: 0 };
      r.counted++;
      if (mark.status !== 'absent') r.attended++;
      rates.set(mark.userId, r);
    }
  }
  const labelRows = rows.length
    ? await db
        .select({ userId: memberLabels.userId, label: groupLabels })
        .from(memberLabels)
        .innerJoin(groupLabels, eq(groupLabels.id, memberLabels.labelId))
        .where(
          and(
            eq(groupLabels.groupId, group.id),
            inArray(
              memberLabels.userId,
              rows.map((r) => r.u.id),
            ),
          ),
        )
        .orderBy(asc(groupLabels.sort), asc(groupLabels.id))
    : [];
  const secret = c.env.WEBHOOK_SECRET;
  const photos = new Map(
    await Promise.all(
      rows
        .filter(({ u }) => u.photoMediaId)
        .map(async ({ u }) => [u.id, await signedMediaUrl(secret, u.photoMediaId!)] as const),
    ),
  );
  const result: MemberRow[] = rows.map(({ m, u, positionName, positionLook }) => ({
    photoUrl: photos.get(u.id) ?? null,
    labels: labelRows.filter((l) => l.userId === u.id).map((l) => toLabelRef(l.label)),
    membershipId: m.id,
    positionId: m.positionId,
    positionName,
    positionLook: positionLook ?? null,
    userId: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt,
    requestedAt: m.createdAt,
    offline: u.telegramId === null,
    isReachable: u.isReachable,
    isAdmin: u.isAdmin,
    guardianConsent: u.guardianConsentAt !== null,
    recentPercent: rates.get(u.id)?.counted
      ? Math.round((rates.get(u.id)!.attended / rates.get(u.id)!.counted) * 100)
      : null,
  }));
  return c.json(result);
});

/** Adds a member without Telegram (active immediately). */
groupRoutes.post('/:id/members', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'people.manage');
  const input = await parseBody(c, addOfflineMemberSchema);
  const now = new Date().toISOString();
  const [created] = await db
    .insert(users)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      guardianConsentAt: input.guardianConsent ? now : null,
      guardianConsentBy: input.guardianConsent ? user.id : null,
    })
    .returning();
  const [membership] = await db
    .insert(memberships)
    .values({
      userId: created!.id,
      groupId: group.id,
      role: 'member',
      status: 'active',
      joinedAt: now,
      positionId: await defaultPositionId(db, group.id),
    })
    .returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'offline_member_added',
    entity: 'membership',
    entityId: membership!.id,
    groupId: group.id,
    data: { userId: created!.id },
  });
  return c.json({ userId: created!.id, membershipId: membership!.id }, 201);
});

/**
 * People from the whole church (anyone who has used the bot, plus members added
 * without Telegram) that could be added here. Needs the right to manage people.
 */
groupRoutes.get('/:id/people-search', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'people.manage');
  const q = (c.req.query('q') ?? '').trim().replace(/^@/, '').toLocaleLowerCase();
  // SQLite's lower() only folds Latin letters, so Cyrillic/Lithuanian names are matched
  // here instead. A church directory is small enough to scan.
  const everyone = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      telegramId: users.telegramId,
    })
    .from(users)
    .where(isNull(users.anonymizedAt))
    .orderBy(users.firstName, users.lastName)
    .limit(5000);
  const rows = everyone
    .filter(
      (u) =>
        !q ||
        [
          u.firstName,
          u.lastName ?? '',
          u.username ?? '',
          `${u.firstName} ${u.lastName ?? ''}`,
        ].some((v) => v.toLocaleLowerCase().includes(q)),
    )
    .slice(0, 40);
  const here = rows.length
    ? await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.groupId, group.id),
            inArray(memberships.status, ['active', 'pending']),
            inArray(
              memberships.userId,
              rows.map((r) => r.userId),
            ),
          ),
        )
    : [];
  const inGroup = new Set(here.map((h) => h.userId));
  const result: PersonSearchRow[] = rows.map((r) => ({
    userId: r.userId,
    firstName: r.firstName,
    lastName: r.lastName,
    username: r.username,
    offline: r.telegramId === null,
    inGroup: inGroup.has(r.userId),
  }));
  return c.json(result);
});

/** Adds someone from the church directly (active at once), optionally with a position. */
groupRoutes.post('/:id/members/existing', async (c) => {
  const db = c.get('db');
  const actor = c.get('user');
  const group = await assertCan(db, actor, idParam(c), 'people.manage');
  const input = await parseBody(c, addExistingMemberSchema);
  const person = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  if (!person || person.anonymizedAt) throw new HTTPException(404, { message: 'not_found' });

  let positionId = await defaultPositionId(db, group.id);
  let role: 'leader' | 'member' = 'member';
  if (input.positionId && input.positionId !== positionId) {
    const pos = await db.query.positions.findFirst({ where: eq(positions.id, input.positionId) });
    if (!pos || pos.groupId !== group.id)
      throw new HTTPException(400, { message: 'invalid_position' });
    const mine = (await accessIn(db, actor, group.id)).perms;
    const wanted = permsOf(pos);
    if (!mine.has('positions') || wanted.some((p) => !mine.has(p))) {
      throw new HTTPException(403, { message: 'escalation' });
    }
    positionId = pos.id;
    role = roleFor(wanted);
  }

  const now = new Date().toISOString();
  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.groupId, group.id), eq(memberships.userId, person.id)),
  });
  if (existing?.status === 'active') throw new HTTPException(409, { message: 'already_member' });
  const [membership] = existing
    ? await db
        .update(memberships)
        .set({ status: 'active', joinedAt: now, leftAt: null, positionId, role })
        .where(eq(memberships.id, existing.id))
        .returning()
    : await db
        .insert(memberships)
        .values({
          userId: person.id,
          groupId: group.id,
          status: 'active',
          joinedAt: now,
          positionId,
          role,
        })
        .returning();
  await audit(db, {
    actorUserId: actor.id,
    action: 'member_added',
    entity: 'membership',
    entityId: membership!.id,
    groupId: group.id,
    data: { userId: person.id, positionId },
  });
  return c.json({ userId: person.id, membershipId: membership!.id }, 201);
});

/** Brings back a deleted (archived) ministry. Church admins only. */
groupRoutes.post('/:id/restore', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!user.isAdmin) throw new HTTPException(403, { message: 'forbidden' });
  const group = await loadGroupOr404(db, idParam(c));
  await db.update(groups).set({ archivedAt: null }).where(eq(groups.id, group.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'group_restored',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
  });
  return c.json({ ok: true });
});

/** Link for adding the bot to a Telegram group, which then becomes members-only. */
groupRoutes.post('/:id/chat/link', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'settings');
  return c.json({ url: await startChatLink(db, group, await botUsername(c.env)) });
});

groupRoutes.delete('/:id/chat', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'settings');
  await unlinkChat(botApi(c.env), db, group);
  return c.json({ ok: true });
});

/** Everyone active in the ministry with their position: members may see and write to each other. */
groupRoutes.get('/:id/contacts', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanViewGroup(db, user, idParam(c));
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      telegramId: users.telegramId,
      isAdmin: users.isAdmin,
      positionName: positions.name,
      positionLook: positions.look,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(and(eq(memberships.groupId, group.id), eq(memberships.status, 'active')))
    .orderBy(users.firstName);
  const labelRows = rows.length
    ? await db
        .select({ userId: memberLabels.userId, label: groupLabels })
        .from(memberLabels)
        .innerJoin(groupLabels, eq(groupLabels.id, memberLabels.labelId))
        .where(
          and(
            eq(groupLabels.groupId, group.id),
            inArray(
              memberLabels.userId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .orderBy(asc(groupLabels.sort), asc(groupLabels.id))
    : [];
  const list: ContactRow[] = rows.map(({ telegramId, ...r }) => ({
    ...r,
    offline: telegramId === null,
    labels: labelRows.filter((l) => l.userId === r.id).map((l) => toLabelRef(l.label)),
  }));
  return c.json(list);
});

/** Opening the feed: everything in it counts as seen. */
groupRoutes.post('/:id/feed/read', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanViewGroup(db, user, idParam(c));
  await markFeedRead(db, user.id, group.id);
  return c.json({ ok: true });
});
