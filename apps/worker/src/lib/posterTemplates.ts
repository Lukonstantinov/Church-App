import { inArray } from 'drizzle-orm';
import {
  posterBackgroundSchema,
  posterFrameSchema,
  posterLayerSchema,
  type PosterLayer,
  type PosterTemplate,
} from '@church/shared';
import type { Db } from '../db/client';
import { posterTemplates } from '../db/schema';
import { signedMediaUrl } from './media';

type Row = typeof posterTemplates.$inferSelect;

/** A stored poster template with signed links to its pictures; bad parts are left out. */
export async function readPosterTemplate(
  row: Row,
  secret: string,
  userId?: number,
): Promise<PosterTemplate> {
  const parse = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const bg = posterBackgroundSchema.safeParse(parse(row.background));
  const background = bg.success ? bg.data : posterBackgroundSchema.parse({});
  const rawLayers = parse(row.layers);
  const layers: PosterLayer[] = [];
  for (const raw of Array.isArray(rawLayers) ? rawLayers : []) {
    const l = posterLayerSchema.safeParse(raw);
    if (!l.success) continue;
    layers.push(
      l.data.type === 'image'
        ? { ...l.data, url: await signedMediaUrl(secret, l.data.mediaId) }
        : l.data,
    );
  }
  return {
    id: row.id,
    name: row.name,
    background: {
      ...background,
      url: background.mediaId ? await signedMediaUrl(secret, background.mediaId) : null,
    },
    layers,
    frame: row.frame ? (posterFrameSchema.safeParse(parse(row.frame)).data ?? null) : null,
    mine: userId !== undefined && row.createdBy === userId,
  };
}

/** Several templates at once, by id (for lists of events and meetings). */
export async function posterTemplatesById(
  db: Db,
  ids: (number | null | undefined)[],
  secret: string,
): Promise<Map<number, PosterTemplate>> {
  const wanted = [...new Set(ids.filter((x): x is number => !!x))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select().from(posterTemplates).where(inArray(posterTemplates.id, wanted));
  return new Map(
    await Promise.all(rows.map(async (r) => [r.id, await readPosterTemplate(r, secret)] as const)),
  );
}
