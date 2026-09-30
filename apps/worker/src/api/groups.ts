import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  addOfflineMemberSchema,
  createGroupSchema,
  displayName,
  updateGroupSchema,
  type GroupDetail,
  type GroupRole,
  type GroupSummary,
  type MemberRow,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import type { Db } from '../db/client';
import { groups, memberships, users, type Group, type User } from '../db/schema';
import { assertCanManageGroup, assertCanViewGroup, canManageGroup } from '../lib/access';
import { audit } from '../lib/audit';
import { randomCode } from '../lib/codes';
import { botUsername, inviteLink } from '../lib/telegram';
import { idParam, parseBody } from './util';

export const groupRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

async function summarize(db: Db, user: User, list: Group[]): Promise<GroupSummary[]> {
  if (list.length === 0) return [];
  const ids = list.map((g) => g.id);
  const [counts, leaders, mine] = await Promise.all([
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
      .select({ groupId: memberships.groupId, role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          inArray(memberships.groupId, ids),
          eq(memberships.status, 'active'),
        ),
      ),
  ]);
  const countBy = new Map(counts.map((c) => [c.groupId, c]));
  const roleBy = new Map<number, GroupRole>(mine.map((m) => [m.groupId, m.role]));
  return list.map((g) => {
    const myRole = roleBy.get(g.id) ?? null;
    const manages = user.isAdmin || myRole === 'leader';
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      archived: g.archivedAt !== null,
      activeCount: Number(countBy.get(g.id)?.active ?? 0),
      pendingCount: manages ? Number(countBy.get(g.id)?.pending ?? 0) : 0,
      leaderNames: leaders.filter((l) => l.groupId === g.id).map(displayName),
      myRole,
    };
  });
}

/** Admins: all groups (archived with ?archived=1). Others: groups they actively belong to. */
groupRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  let list: Group[];
  if (user.isAdmin) {
    list = await db.query.groups.findMany({
      where: c.req.query('archived') === '1' ? undefined : isNull(groups.archivedAt),
      orderBy: groups.name,
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
      .orderBy(groups.name);
    list = rows.map((r) => r.group);
  }
  return c.json(await summarize(db, user, list));
});

groupRoutes.post('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!user.isAdmin) throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, createGroupSchema);
  const [group] = await db
    .insert(groups)
    .values({ name: input.name, description: input.description, inviteCode: randomCode(10) })
    .returning();
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
  const [summary] = await summarize(db, user, [group]);
  const canManage = await canManageGroup(db, user, group.id);
  const detail: GroupDetail = {
    ...summary!,
    canManage,
    inviteLink: canManage ? inviteLink(await botUsername(c.env), group.inviteCode) : null,
  };
  return c.json(detail);
});

groupRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanManageGroup(db, user, idParam(c));
  const input = await parseBody(c, updateGroupSchema);
  await db.update(groups).set(input).where(eq(groups.id, group.id));
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

groupRoutes.post('/:id/archive', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!user.isAdmin) throw new HTTPException(403, { message: 'forbidden' });
  const group = await assertCanManageGroup(db, user, idParam(c));
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
  const group = await assertCanManageGroup(db, user, idParam(c));
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
  const group = await assertCanManageGroup(db, user, idParam(c));
  const statuses =
    c.req.query('status') === 'all'
      ? (['pending', 'active', 'left', 'rejected'] as const)
      : (['pending', 'active'] as const);
  const rows = await db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupId, group.id), inArray(memberships.status, [...statuses])))
    .orderBy(users.firstName, users.lastName);
  const result: MemberRow[] = rows.map(({ m, u }) => ({
    membershipId: m.id,
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
    guardianConsent: u.guardianConsentAt !== null,
  }));
  return c.json(result);
});

/** Adds a member without Telegram (active immediately). */
groupRoutes.post('/:id/members', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanManageGroup(db, user, idParam(c));
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
