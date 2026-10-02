import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq, ne } from 'drizzle-orm';
import {
  labelExtra,
  readLabelLook,
  positionInputSchema,
  type labelLookSchema,
  type Permission,
} from '@church/shared';
import type { z } from 'zod';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { memberships, positions } from '../db/schema';
import { accessIn, assertCan } from '../lib/access';
import { audit } from '../lib/audit';
import { listPositions, permsOf } from '../lib/positions';
import { idParam, parseBody } from './util';

/** A position's look as stored: the full look, colours in lower case. */
const lookOf = (l: z.output<typeof labelLookSchema>) =>
  readLabelLook(
    {
      color: l.color.toLowerCase(),
      color2: l.colors?.[1] ?? l.color2 ?? null,
      style: l.style,
      animation: l.animation,
    },
    labelExtra(l),
  );

type App = { Bindings: Env; Variables: AuthVariables };

/** Nobody can hand out rights they don't hold themselves (church admins hold all). */
function assertNoEscalation(mine: Set<Permission>, wanted: readonly Permission[]) {
  if (wanted.some((p) => !mine.has(p))) throw new HTTPException(403, { message: 'escalation' });
}

/** /api/groups/:id/positions */
export const groupPositionRoutes = new Hono<App>();

groupPositionRoutes.get('/:id/positions', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), ['positions', 'people.view']);
  return c.json(await listPositions(db, group.id));
});

groupPositionRoutes.post('/:id/positions', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'positions');
  const input = await parseBody(c, positionInputSchema);
  assertNoEscalation((await accessIn(db, user, group.id)).perms, input.permissions);
  const existing = await listPositions(db, group.id);
  const [row] = await db
    .insert(positions)
    .values({
      groupId: group.id,
      name: input.name,
      look: input.look ? lookOf(input.look) : null,
      description: input.description,
      permissions: input.permissions,
      isDefault: false,
      sort: existing.length,
    })
    .returning();
  if (input.isDefault) await makeDefault(c.get('db'), group.id, row!.id);
  await audit(db, {
    actorUserId: user.id,
    action: 'position_created',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: { positionId: row!.id, name: input.name, permissions: input.permissions },
  });
  return c.json(await listPositions(db, group.id), 201);
});

async function makeDefault(db: AuthVariables['db'], groupId: number, positionId: number) {
  await db
    .update(positions)
    .set({ isDefault: false })
    .where(and(eq(positions.groupId, groupId), ne(positions.id, positionId)));
  await db.update(positions).set({ isDefault: true }).where(eq(positions.id, positionId));
}

async function loadPosition(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const pos = await db.query.positions.findFirst({ where: eq(positions.id, id) });
  if (!pos) throw new HTTPException(404, { message: 'not_found' });
  await assertCan(db, user, pos.groupId, 'positions');
  const mine = (await accessIn(db, user, pos.groupId)).perms;
  return { db, user, pos, mine };
}

/** /api/positions/:id */
export const positionRoutes = new Hono<App>();

positionRoutes.patch('/:id', async (c) => {
  const { db, user, pos, mine } = await loadPosition(c, idParam(c));
  const input = await parseBody(c, positionInputSchema);
  // Both what it grants now and what it will grant must be within the editor's rights.
  assertNoEscalation(mine, [...permsOf(pos), ...input.permissions]);
  await db
    .update(positions)
    .set({
      name: input.name,
      description: input.description,
      permissions: input.permissions,
      ...(input.look !== undefined ? { look: input.look ? lookOf(input.look) : null } : {}),
    })
    .where(eq(positions.id, pos.id));
  if (input.isDefault && !pos.isDefault) await makeDefault(db, pos.groupId, pos.id);
  await audit(db, {
    actorUserId: user.id,
    action: 'position_updated',
    entity: 'group',
    entityId: pos.groupId,
    groupId: pos.groupId,
    data: { positionId: pos.id, name: input.name, permissions: input.permissions },
  });
  return c.json(await listPositions(db, pos.groupId));
});

positionRoutes.delete('/:id', async (c) => {
  const { db, user, pos, mine } = await loadPosition(c, idParam(c));
  assertNoEscalation(mine, permsOf(pos));
  if (pos.isDefault) throw new HTTPException(409, { message: 'default_position' });
  const holder = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(memberships.positionId, pos.id), eq(memberships.status, 'active')),
  });
  if (holder) throw new HTTPException(409, { message: 'position_in_use' });
  await db.update(memberships).set({ positionId: null }).where(eq(memberships.positionId, pos.id));
  await db.delete(positions).where(eq(positions.id, pos.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'position_deleted',
    entity: 'group',
    entityId: pos.groupId,
    groupId: pos.groupId,
    data: { positionId: pos.id, name: pos.name },
  });
  return c.json(await listPositions(db, pos.groupId));
});
