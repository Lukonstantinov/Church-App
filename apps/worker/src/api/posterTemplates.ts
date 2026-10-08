import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, inArray, or } from 'drizzle-orm';
import { posterTemplateInputSchema, type PosterTemplateInput } from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { events, media, meetings, posterTemplates } from '../db/schema';
import { readPosterTemplate } from '../lib/posterTemplates';
import { canDesign } from './announcements';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/**
 * /api/poster-templates — church-wide poster templates (Design → Posters): a background
 * and layers of pictures, texts and effects. The same people who may save design
 * templates make them; the maker or a church admin changes or deletes one.
 */
export const posterTemplateRoutes = new Hono<App>();

/** Every picture a template uses must exist. */
async function assertPictures(db: AuthVariables['db'], input: PosterTemplateInput) {
  const ids = [
    input.background.mediaId,
    ...input.layers.map((l) => (l.type === 'image' ? l.mediaId : null)),
  ].filter((x): x is number => !!x);
  if (ids.length === 0) return;
  const found = await db
    .select({ id: media.id })
    .from(media)
    .where(inArray(media.id, [...new Set(ids)]));
  if (found.length !== new Set(ids).size)
    throw new HTTPException(400, { message: 'invalid_media' });
}

/** Stored without the signed links (they are made fresh on reading). */
function toColumns(input: ReturnType<typeof posterTemplateInputSchema.parse>) {
  return {
    name: input.name,
    background: JSON.stringify({ ...input.background, url: undefined }),
    layers: JSON.stringify(
      input.layers.map((l) => (l.type === 'image' ? { ...l, url: undefined } : l)),
    ),
  };
}

posterTemplateRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!(await canDesign(c))) throw new HTTPException(403, { message: 'forbidden' });
  const rows = await db.select().from(posterTemplates).orderBy(posterTemplates.id);
  return c.json(
    await Promise.all(rows.map((r) => readPosterTemplate(r, c.env.WEBHOOK_SECRET, user.id))),
  );
});

posterTemplateRoutes.post('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!(await canDesign(c))) throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, posterTemplateInputSchema);
  await assertPictures(db, input);
  const [row] = await db
    .insert(posterTemplates)
    .values({ ...toColumns(input), createdBy: user.id })
    .returning();
  return c.json(await readPosterTemplate(row!, c.env.WEBHOOK_SECRET, user.id), 201);
});

posterTemplateRoutes.put('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const row = await db.query.posterTemplates.findFirst({
    where: eq(posterTemplates.id, idParam(c)),
  });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  if (row.createdBy !== user.id && !user.isAdmin)
    throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, posterTemplateInputSchema);
  await assertPictures(db, input);
  const [next] = await db
    .update(posterTemplates)
    .set(toColumns(input))
    .where(eq(posterTemplates.id, row.id))
    .returning();
  return c.json(await readPosterTemplate(next!, c.env.WEBHOOK_SECRET, user.id));
});

/** Deleting one takes it off the events and meetings that used it (they keep their own look). */
posterTemplateRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const row = await db.query.posterTemplates.findFirst({
    where: eq(posterTemplates.id, idParam(c)),
  });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  if (row.createdBy !== user.id && !user.isAdmin)
    throw new HTTPException(403, { message: 'forbidden' });
  await db
    .update(events)
    .set({ posterTemplateId: null })
    .where(or(eq(events.posterTemplateId, row.id)));
  await db
    .update(meetings)
    .set({ posterTemplateId: null })
    .where(eq(meetings.posterTemplateId, row.id));
  await db.delete(posterTemplates).where(eq(posterTemplates.id, row.id));
  return c.json({ ok: true });
});
