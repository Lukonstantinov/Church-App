import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  labelExtra,
  labelInputSchema,
  readLabelLook,
  setMemberLabelsSchema,
  type LabelRef,
} from '@church/shared';
import type { z } from 'zod';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { groupLabels, memberLabels, memberships } from '../db/schema';
import { assertCan, assertCanViewGroup } from '../lib/access';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

export const toLabelRef = (r: typeof groupLabels.$inferSelect): LabelRef => ({
  id: r.id,
  name: r.name,
  ...readLabelLook(r, r.look),
});

/** The stored columns of a label from what the editor sent. */
function columns(input: z.output<typeof labelInputSchema>) {
  const colors = input.colors ?? (input.color2 ? [input.color, input.color2] : null);
  return {
    name: input.name,
    color: (colors?.[0] ?? input.color).toLowerCase(),
    color2: (colors?.[1] ?? input.color2)?.toLowerCase() ?? null,
    style: input.style,
    animation: input.animation,
    look: labelExtra({ ...input, colors }),
  };
}
const toRef = toLabelRef;

/** /api/groups/:id/labels */
export const groupLabelRoutes = new Hono<App>();

groupLabelRoutes.get('/:id/labels', async (c) => {
  const db = c.get('db');
  const group = await assertCanViewGroup(db, c.get('user'), idParam(c));
  const rows = await db
    .select()
    .from(groupLabels)
    .where(eq(groupLabels.groupId, group.id))
    .orderBy(asc(groupLabels.sort), asc(groupLabels.id));
  return c.json(rows.map(toRef));
});

groupLabelRoutes.post('/:id/labels', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'people.manage');
  const input = await parseBody(c, labelInputSchema);
  const existing = await db
    .select({ id: groupLabels.id })
    .from(groupLabels)
    .where(eq(groupLabels.groupId, group.id));
  if (existing.length >= 30) throw new HTTPException(409, { message: 'too_many_labels' });
  const [row] = await db
    .insert(groupLabels)
    .values({
      groupId: group.id,
      ...columns(input),
      sort: existing.length,
      createdBy: c.get('user').id,
    })
    .returning();
  return c.json(toRef(row!), 201);
});

/** Which labels a person has in this ministry (replaces the list). */
groupLabelRoutes.put('/:id/members/:userId/labels', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'people.manage');
  const userId = idParam(c, 'userId');
  const { labelIds } = await parseBody(c, setMemberLabelsSchema);
  const member = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(
      eq(memberships.groupId, group.id),
      eq(memberships.userId, userId),
      eq(memberships.status, 'active'),
    ),
  });
  if (!member) throw new HTTPException(404, { message: 'not_found' });
  const own = await db
    .select({ id: groupLabels.id })
    .from(groupLabels)
    .where(eq(groupLabels.groupId, group.id));
  const ownIds = new Set(own.map((l) => l.id));
  if (labelIds.some((id) => !ownIds.has(id)))
    throw new HTTPException(400, { message: 'invalid_label' });
  if (ownIds.size > 0)
    await db
      .delete(memberLabels)
      .where(and(eq(memberLabels.userId, userId), inArray(memberLabels.labelId, [...ownIds])));
  const unique = [...new Set(labelIds)];
  if (unique.length)
    await db.insert(memberLabels).values(unique.map((labelId) => ({ labelId, userId })));
  return c.json({ ok: true });
});

/** /api/labels/:id */
export const labelRoutes = new Hono<App>();

async function loadLabel(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const label = await db.query.groupLabels.findFirst({ where: eq(groupLabels.id, id) });
  if (!label) throw new HTTPException(404, { message: 'not_found' });
  await assertCan(db, user, label.groupId, 'people.manage');
  return { db, label };
}

labelRoutes.patch('/:id', async (c) => {
  const { db, label } = await loadLabel(c, idParam(c));
  const input = await parseBody(c, labelInputSchema);
  const [row] = await db
    .update(groupLabels)
    .set(columns(input))
    .where(eq(groupLabels.id, label.id))
    .returning();
  return c.json(toRef(row!));
});

labelRoutes.delete('/:id', async (c) => {
  const { db, label } = await loadLabel(c, idParam(c));
  await db.delete(memberLabels).where(eq(memberLabels.labelId, label.id));
  await db.delete(groupLabels).where(eq(groupLabels.id, label.id));
  return c.json({ ok: true });
});
