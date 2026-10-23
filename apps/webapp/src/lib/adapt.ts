/** The rules for keeping animations smooth, kept apart from the browser so they can be tested. */

/** The shader pictures never shrink below this share of their designed size. */
export const SCALE_MIN = 0.6;

/** One step of the shader resolution: smaller when drawing is slow, back up when it is easy. */
export function stepScale(scale: number, slow: boolean): number {
  return slow ? Math.max(SCALE_MIN, scale * 0.8) : Math.min(1, scale * 1.2);
}

export type Level = 'full' | 'lite' | 'still';
/** How long "auto" remembers that the phone struggled. */
export const AUTO_TTL_MS = 3 * 24 * 3600_000;

/** What "auto" uses: the remembered level ("lite@1700000000000") while it is fresh. */
export function autoLevel(stored: string | null, now: number, weakPhone: boolean): Level {
  const [v, at] = (stored ?? '').split('@');
  const fresh = now - Number(at) < AUTO_TTL_MS;
  return (v === 'full' || v === 'lite' || v === 'still') && fresh ? v : weakPhone ? 'lite' : 'full';
}
