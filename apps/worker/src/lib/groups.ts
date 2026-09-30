import { and, eq, isNull } from 'drizzle-orm';
import { pickMinistryColor } from '@church/shared';
import type { Db } from '../db/client';
import { groups, type Group } from '../db/schema';
import { getChurch } from './church';

/** Public, cacheable logo URL of an environment (the media id versions it). */
export const groupLogoUrl = (g: Pick<Group, 'id' | 'logoMediaId'>): string | null =>
  g.logoMediaId ? `/media/g/${g.id}/logo?v=${g.logoMediaId}` : null;

/** A colour for a new ministry: one no other ministry (nor the church) uses yet. */
export async function freeMinistryColor(db: Db, extraTaken: string[] = []) {
  const rows = await db
    .select({ c: groups.brandColor })
    .from(groups)
    .where(isNull(groups.archivedAt));
  return pickMinistryColor(
    [...rows.map((r) => r.c), ...extraTaken],
    (await getChurch(db)).brandColor,
  );
}

/**
 * Ministries created before they had their own colour (they showed the church's) get a
 * distinct one the first time they're listed. Updates `list` in place.
 */
export async function assignMissingColors(db: Db, list: Group[]) {
  const assigned: string[] = [];
  for (const g of list) {
    if (g.brandColor) continue;
    const color = await freeMinistryColor(db, assigned);
    assigned.push(color);
    await db
      .update(groups)
      .set({ brandColor: color })
      .where(and(eq(groups.id, g.id), isNull(groups.brandColor)));
    g.brandColor = color;
  }
}
