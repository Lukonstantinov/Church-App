import type { Group } from '../db/schema';

/** Public, cacheable logo URL of an environment (the media id versions it). */
export const groupLogoUrl = (g: Pick<Group, 'id' | 'logoMediaId'>): string | null =>
  g.logoMediaId ? `/media/g/${g.id}/logo?v=${g.logoMediaId}` : null;
