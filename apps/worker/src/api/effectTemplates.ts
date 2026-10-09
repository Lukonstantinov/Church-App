import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import {
  effectTemplateInputSchema,
  type EffectTemplate,
  type EffectTemplateInput,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { effectTemplates } from '../db/schema';
import { groupsWithPermission } from '../lib/access';
import { canDesign } from './announcements';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/**
 * /api/effect-templates — saved sets of effects, shared church-wide. Anyone who may put
 * effects on things saves one; the maker or a church admin renames or deletes it.
 */
export const effectTemplateRoutes = new Hono<App>();

type Row = typeof effectTemplates.$inferSelect;

/** A stored set; effects that no longer exist in the app are left out. */
function read(row: Row, userId: number): EffectTemplate {
  let raw: unknown = null;
  try {
    raw = JSON.parse(row.effects);
  } catch {
    // A broken row reads as empty rather than failing the whole list.
  }
  const effects = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    const one = effectTemplateInputSchema.shape.effects.element.safeParse(e);
    if (one.success) effects.push(one.data);
  }
  return { id: row.id, name: row.name, effects, mine: row.createdBy === userId };
}

const columns = (input: EffectTemplateInput) => ({
  name: input.name,
  effects: JSON.stringify(input.effects),
});

/**
 * Whoever may put effects on something uses the sets: designers, and those who make
 * events or meetings (their forms have the effects picker too).
 */
effectTemplateRoutes.use('*', async (c, next) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!(await canDesign(c))) {
    const [ev, mt] = await Promise.all([
      groupsWithPermission(db, user.id, 'events.manage'),
      groupsWithPermission(db, user.id, 'meetings.manage'),
    ]);
    if (ev.length + mt.length === 0) throw new HTTPException(403, { message: 'forbidden' });
  }
  await next();
});

effectTemplateRoutes.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.get('db').select().from(effectTemplates).orderBy(effectTemplates.id);
  return c.json(rows.map((r) => read(r, user.id)).filter((x) => x.effects.length > 0));
});

effectTemplateRoutes.post('/', async (c) => {
  const user = c.get('user');
  const input = await parseBody(c, effectTemplateInputSchema);
  const [row] = await c
    .get('db')
    .insert(effectTemplates)
    .values({ ...columns(input), createdBy: user.id })
    .returning();
  return c.json(read(row!, user.id), 201);
});

/** The set behind :id, if this person may change it. */
async function own(c: Context<App>) {
  const user = c.get('user');
  const row = await c.get('db').query.effectTemplates.findFirst({
    where: eq(effectTemplates.id, idParam(c)),
  });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  if (row.createdBy !== user.id && !user.isAdmin)
    throw new HTTPException(403, { message: 'forbidden' });
  return row;
}

effectTemplateRoutes.put('/:id', async (c) => {
  const row = await own(c);
  const input = await parseBody(c, effectTemplateInputSchema);
  const [next] = await c
    .get('db')
    .update(effectTemplates)
    .set(columns(input))
    .where(eq(effectTemplates.id, row.id))
    .returning();
  return c.json(read(next!, c.get('user').id));
});

effectTemplateRoutes.delete('/:id', async (c) => {
  const row = await own(c);
  await c.get('db').delete(effectTemplates).where(eq(effectTemplates.id, row.id));
  return c.json({ ok: true });
});
