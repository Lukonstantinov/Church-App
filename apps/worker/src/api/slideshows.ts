import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { desc, eq, inArray } from 'drizzle-orm';
import {
  posterBackgroundSchema,
  posterFrameSchema,
  posterLayerSchema,
  slideSchema,
  slideshowInputSchema,
  type PosterLayer,
  type SavedSlideshow,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { media, slideshows } from '../db/schema';
import { signedMediaUrl } from '../lib/media';
import { canDesign } from './announcements';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };
type Input = ReturnType<typeof slideshowInputSchema.parse>;

/**
 * /api/slideshows — saved slideshows of the animated poster maker, church-wide: the same
 * people who make poster templates save, open and share them; the maker or a church admin
 * changes or deletes one.
 */
export const slideshowRoutes = new Hono<App>();

const plain = (layers: PosterLayer[]) =>
  layers.map((l) => (l.type === 'image' ? { ...l, url: undefined, sourceUrl: undefined } : l));

function toDoc(input: Input) {
  return JSON.stringify({
    background: { ...input.background, url: undefined },
    layers: plain(input.layers),
    frame: input.frame ?? null,
    slides: input.slides.map((s) => ({ ...s, layers: plain(s.layers) })),
  });
}

/** Every picture it uses must exist. */
async function assertPictures(db: AuthVariables['db'], input: Input) {
  const ids = [
    input.background.mediaId,
    ...[input.layers, ...input.slides.map((s) => s.layers)].flatMap((ls) =>
      ls.flatMap((l) => (l.type === 'image' ? [l.mediaId, l.source] : [])),
    ),
  ].filter((x): x is number => !!x);
  if (ids.length === 0) return;
  const found = await db
    .select({ id: media.id })
    .from(media)
    .where(inArray(media.id, [...new Set(ids)]));
  if (found.length !== new Set(ids).size)
    throw new HTTPException(400, { message: 'invalid_media' });
}

/** A stored slideshow with signed links to its pictures; bad parts are left out. */
async function read(
  row: typeof slideshows.$inferSelect,
  secret: string,
  userId: number,
): Promise<SavedSlideshow> {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(row.doc) as Record<string, unknown>;
  } catch {
    // Unreadable: an empty slideshow.
  }
  const layersOf = async (list: unknown) => {
    const out: PosterLayer[] = [];
    for (const item of Array.isArray(list) ? list : []) {
      const l = posterLayerSchema.safeParse(item);
      if (!l.success) continue;
      out.push(
        l.data.type === 'image'
          ? {
              ...l.data,
              url: await signedMediaUrl(secret, l.data.mediaId),
              sourceUrl: l.data.source ? await signedMediaUrl(secret, l.data.source) : null,
            }
          : l.data,
      );
    }
    return out;
  };
  const bg = posterBackgroundSchema.safeParse(raw.background);
  const background = bg.success ? bg.data : posterBackgroundSchema.parse({});
  const slides = [];
  for (const item of Array.isArray(raw.slides) ? raw.slides : []) {
    const s = slideSchema.safeParse({ ...(item as object), layers: [] });
    if (!s.success) continue;
    slides.push({ ...s.data, layers: await layersOf((item as { layers?: unknown }).layers) });
  }
  return {
    id: row.id,
    name: row.name,
    background: {
      ...background,
      url: background.mediaId ? await signedMediaUrl(secret, background.mediaId) : null,
    },
    layers: await layersOf(raw.layers),
    frame: raw.frame ? (posterFrameSchema.safeParse(raw.frame).data ?? null) : null,
    slides,
    mine: row.createdBy === userId,
  };
}

slideshowRoutes.get('/', async (c) => {
  if (!(await canDesign(c))) throw new HTTPException(403, { message: 'forbidden' });
  const rows = await c.get('db').select().from(slideshows).orderBy(desc(slideshows.id));
  const user = c.get('user');
  return c.json(await Promise.all(rows.map((r) => read(r, c.env.WEBHOOK_SECRET, user.id))));
});

slideshowRoutes.post('/', async (c) => {
  if (!(await canDesign(c))) throw new HTTPException(403, { message: 'forbidden' });
  const db = c.get('db');
  const user = c.get('user');
  const input = await parseBody(c, slideshowInputSchema);
  await assertPictures(db, input);
  const [row] = await db
    .insert(slideshows)
    .values({ name: input.name, doc: toDoc(input), createdBy: user.id })
    .returning();
  return c.json(await read(row!, c.env.WEBHOOK_SECRET, user.id), 201);
});

slideshowRoutes.put('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const row = await db.query.slideshows.findFirst({ where: eq(slideshows.id, idParam(c)) });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  if (row.createdBy !== user.id && !user.isAdmin)
    throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, slideshowInputSchema);
  await assertPictures(db, input);
  const [next] = await db
    .update(slideshows)
    .set({ name: input.name, doc: toDoc(input) })
    .where(eq(slideshows.id, row.id))
    .returning();
  return c.json(await read(next!, c.env.WEBHOOK_SECRET, user.id));
});

slideshowRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const row = await db.query.slideshows.findFirst({ where: eq(slideshows.id, idParam(c)) });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  if (row.createdBy !== user.id && !user.isAdmin)
    throw new HTTPException(403, { message: 'forbidden' });
  await db.delete(slideshows).where(eq(slideshows.id, row.id));
  return c.json({ ok: true });
});
