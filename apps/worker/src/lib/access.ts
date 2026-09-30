import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { PERMISSIONS, normalizePermissions, type Permission } from '@church/shared';
import type { Db } from '../db/client';
import { groups, memberships, positions, type Group, type User } from '../db/schema';

const ALL = new Set<Permission>(PERMISSIONS);
const NONE = new Set<Permission>();

export interface Access {
  /** Active member (or church admin). */
  member: boolean;
  perms: Set<Permission>;
}

/**
 * What a user may do in an environment: church admins everything, active members what
 * their position grants. Memberships without a position fall back to the old roles.
 */
export async function accessIn(db: Db, user: User, groupId: number): Promise<Access> {
  if (user.isAdmin) return { member: true, perms: ALL };
  const row = await db
    .select({ role: memberships.role, permissions: positions.permissions })
    .from(memberships)
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.groupId, groupId),
        eq(memberships.status, 'active'),
      ),
    )
    .get();
  if (!row) return { member: false, perms: NONE };
  if (row.permissions)
    return { member: true, perms: new Set(normalizePermissions(row.permissions)) };
  return { member: true, perms: row.role === 'leader' ? ALL : NONE };
}

export async function can(db: Db, user: User, groupId: number, perm: Permission) {
  return (await accessIn(db, user, groupId)).perms.has(perm);
}

/** Any management right at all (shows the leader app). */
export async function canManageGroup(db: Db, user: User, groupId: number): Promise<boolean> {
  return (await accessIn(db, user, groupId)).perms.size > 0;
}

export async function loadGroupOr404(db: Db, groupId: number): Promise<Group> {
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!group) throw new HTTPException(404, { message: 'group_not_found' });
  return group;
}

/**
 * Loads the environment (404 if it doesn't exist) and checks a right (403 otherwise).
 * `perm` may be a list: any one of them is enough.
 */
export async function assertCan(
  db: Db,
  user: User,
  groupId: number,
  perm: Permission | Permission[] | 'any',
): Promise<Group> {
  const group = await loadGroupOr404(db, groupId);
  const a = await accessIn(db, user, groupId);
  const ok =
    a.member &&
    (perm === 'any'
      ? a.perms.size > 0
      : (Array.isArray(perm) ? perm : [perm]).some((p) => a.perms.has(p)));
  if (!ok) throw new HTTPException(403, { message: 'forbidden' });
  return group;
}

export async function assertCanViewGroup(db: Db, user: User, groupId: number): Promise<Group> {
  const group = await loadGroupOr404(db, groupId);
  if (!(await accessIn(db, user, groupId)).member) {
    throw new HTTPException(404, { message: 'group_not_found' });
  }
  return group;
}

/** Environments where the user has a given right (active membership). */
export async function groupsWithPermission(
  db: Db,
  userId: number,
  perm: Permission,
): Promise<number[]> {
  const rows = await db
    .select({
      groupId: memberships.groupId,
      role: memberships.role,
      permissions: positions.permissions,
    })
    .from(memberships)
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
  return rows
    .filter((r) =>
      r.permissions ? normalizePermissions(r.permissions).includes(perm) : r.role === 'leader',
    )
    .map((r) => r.groupId);
}

/** Admins manage everyone; others anyone in an environment where they may manage people. */
export async function canManageUser(db: Db, actor: User, targetUserId: number): Promise<boolean> {
  if (actor.isAdmin) return true;
  const led = await groupsWithPermission(db, actor.id, 'people.manage');
  if (led.length === 0) return false;
  const row = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(memberships.userId, targetUserId), inArray(memberships.groupId, led)),
  });
  return row !== undefined;
}

/** Environments whose people the user may see (for the member card). */
export const visibleGroupIds = (db: Db, userId: number) =>
  groupsWithPermission(db, userId, 'people.view');
