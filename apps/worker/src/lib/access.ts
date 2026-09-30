import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { GroupRole } from '@church/shared';
import type { Db } from '../db/client';
import { groups, memberships, type Group, type User } from '../db/schema';

/** Active role of a user in a group, or null. */
export async function groupRoleOf(
  db: Db,
  userId: number,
  groupId: number,
): Promise<GroupRole | null> {
  const row = await db.query.memberships.findFirst({
    columns: { role: true },
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupId, groupId),
      eq(memberships.status, 'active'),
    ),
  });
  return row?.role ?? null;
}

export async function loadGroupOr404(db: Db, groupId: number): Promise<Group> {
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!group) throw new HTTPException(404, { message: 'group_not_found' });
  return group;
}

/** Admins and active leaders of the group may manage it. */
export async function canManageGroup(db: Db, user: User, groupId: number): Promise<boolean> {
  return user.isAdmin || (await groupRoleOf(db, user.id, groupId)) === 'leader';
}

export async function assertCanManageGroup(db: Db, user: User, groupId: number): Promise<Group> {
  const group = await loadGroupOr404(db, groupId);
  if (!(await canManageGroup(db, user, groupId)))
    throw new HTTPException(403, { message: 'forbidden' });
  return group;
}

export async function assertCanViewGroup(db: Db, user: User, groupId: number): Promise<Group> {
  const group = await loadGroupOr404(db, groupId);
  if (!user.isAdmin && !(await groupRoleOf(db, user.id, groupId))) {
    throw new HTTPException(404, { message: 'group_not_found' });
  }
  return group;
}

/** Group ids the user leads (active). */
export async function ledGroupIds(db: Db, userId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: memberships.groupId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.role, 'leader'),
        eq(memberships.status, 'active'),
      ),
    );
  return rows.map((r) => r.groupId);
}

/** Admins manage everyone; leaders manage anyone with any membership in a group they lead. */
export async function canManageUser(db: Db, actor: User, targetUserId: number): Promise<boolean> {
  if (actor.isAdmin) return true;
  const led = await ledGroupIds(db, actor.id);
  if (led.length === 0) return false;
  const row = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(memberships.userId, targetUserId), inArray(memberships.groupId, led)),
  });
  return row !== undefined;
}
