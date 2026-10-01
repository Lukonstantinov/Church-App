import { inArray } from 'drizzle-orm';
import { readBackdrop, readPattern, type PostDesign, type PosterLook } from '@church/shared';
import type { Db } from '../db/client';
import { designTemplates, groups } from '../db/schema';
import { groupLogoUrl } from './groups';
import { signedMediaUrl } from './media';

export interface GroupBrand {
  id: number;
  brandColor: string | null;
  pattern: string | null;
  textColor: string;
  logoMediaId: number | null;
  backdrop: string | null;
}
type Template = typeof designTemplates.$inferSelect;

/**
 * A cover's look (posts and events): a template, an own look, or the ministry's, then
 * the design's own colour and "no ministry photo" on top.
 */
export async function posterLook(
  secret: string,
  group: GroupBrand,
  design: PostDesign | null,
  tpl: Template | undefined,
): Promise<PosterLook> {
  const custom = !tpl ? design?.custom : null;
  const backdrop = design?.noBackdrop
    ? null
    : custom
      ? custom.backdrop
      : readBackdrop(tpl ? tpl.backdrop : group.backdrop);
  const backdropUrl = backdrop ? await signedMediaUrl(secret, backdrop.mediaId) : null;
  const base: PosterLook = custom
    ? {
        brandColor: group.brandColor,
        pattern: custom.pattern,
        textColor: custom.textColor,
        logoUrl: groupLogoUrl(group),
        backdrop,
        backdropUrl,
      }
    : tpl
      ? {
          brandColor: tpl.brandColor,
          pattern: readPattern(tpl.pattern),
          textColor: tpl.textColor,
          logoUrl: tpl.logoMediaId ? await signedMediaUrl(secret, tpl.logoMediaId) : null,
          backdrop,
          backdropUrl,
        }
      : {
          brandColor: group.brandColor,
          pattern: readPattern(group.pattern),
          textColor: group.textColor,
          logoUrl: groupLogoUrl(group),
          backdrop,
          backdropUrl,
        };
  return design?.brandColor ? { ...base, brandColor: design.brandColor } : base;
}

/** Group brands and templates needed for a set of covers, loaded in two queries. */
export async function lookSources(db: Db, groupIds: number[], templateIds: (number | null)[]) {
  const gIds = [...new Set(groupIds)];
  const tIds = [...new Set(templateIds.filter((x): x is number => x !== null))];
  const [brands, templates] = await Promise.all([
    gIds.length
      ? db
          .select({
            id: groups.id,
            brandColor: groups.brandColor,
            pattern: groups.pattern,
            textColor: groups.textColor,
            logoMediaId: groups.logoMediaId,
            backdrop: groups.backdrop,
          })
          .from(groups)
          .where(inArray(groups.id, gIds))
      : Promise.resolve([]),
    tIds.length
      ? db.select().from(designTemplates).where(inArray(designTemplates.id, tIds))
      : Promise.resolve([]),
  ]);
  return {
    brandOf: new Map(brands.map((b) => [b.id, b as GroupBrand])),
    templateOf: new Map(templates.map((t) => [t.id, t])),
  };
}
