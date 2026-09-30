import { and, asc, eq, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  messages,
  normalizePermissions,
  type Locale,
  type Permission,
  type PositionRow,
} from '@church/shared';
import type { Db } from '../db/client';
import { memberships, positions, type Position } from '../db/schema';

/** Every new environment starts with "Leader" (all rights) and "Member" (none, default). */
export async function createDefaultPositions(db: Db, groupId: number, locale: Locale) {
  const t = messages(locale).positions;
  const rows = await db
    .insert(positions)
    .values([
      {
        groupId,
        name: t.leader,
        description: t.leaderDescription,
        permissions: [...PERMISSIONS],
        sort: 0,
      },
      { groupId, name: t.member, description: null, permissions: [], isDefault: true, sort: 1 },
    ])
    .returning();
  return { leader: rows[0]!, member: rows[1]! };
}

export async function defaultPositionId(db: Db, groupId: number): Promise<number | null> {
  const row = await db.query.positions.findFirst({
    columns: { id: true },
    where: and(eq(positions.groupId, groupId), eq(positions.isDefault, true)),
  });
  return row?.id ?? null;
}

export const permsOf = (p: Pick<Position, 'permissions'>): Permission[] =>
  normalizePermissions(p.permissions);

/** Legacy role column, kept in step so older code paths and reports stay meaningful. */
export const roleFor = (perms: readonly Permission[]) =>
  perms.includes('people.manage') ? ('leader' as const) : ('member' as const);

export async function listPositions(db: Db, groupId: number): Promise<PositionRow[]> {
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(positions)
      .where(eq(positions.groupId, groupId))
      .orderBy(asc(positions.sort), asc(positions.id)),
    db
      .select({ positionId: memberships.positionId, n: sql<number>`count(*)` })
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), eq(memberships.status, 'active')))
      .groupBy(memberships.positionId),
  ]);
  const countBy = new Map(counts.map((c) => [c.positionId, Number(c.n)]));
  return rows.map((p) => ({
    id: p.id,
    groupId: p.groupId,
    name: p.name,
    description: p.description,
    permissions: permsOf(p),
    isDefault: p.isDefault,
    memberCount: countBy.get(p.id) ?? 0,
  }));
}

/** Effective rights of a membership row (church admins have all). */
export function effectivePermissions(
  isAdmin: boolean,
  row: { role: string; permissions: string[] | null },
): Permission[] {
  if (isAdmin) return [...PERMISSIONS];
  if (row.permissions) return normalizePermissions(row.permissions);
  return row.role === 'leader' ? [...PERMISSIONS] : [];
}
