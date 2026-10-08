/**
 * Fixed particle spots and what the season animations drop: shared by the CSS animation
 * layers and the particle canvas, so both look the same.
 */

/**
 * Fixed spots for particles (embers, bubbles, snow, fireflies, confetti, icons): place
 * across, size, how long one trip takes, where in its trip it starts, and how far it sways.
 */
export const PARTICLES = [
  { x: 6, s: 4, d: 9, t: 1, w: 14 },
  { x: 15, s: 6, d: 12, t: 7, w: -18 },
  { x: 24, s: 3, d: 8, t: 4, w: 10 },
  { x: 33, s: 5, d: 11, t: 9, w: -12 },
  { x: 42, s: 4, d: 10, t: 2, w: 16 },
  { x: 51, s: 7, d: 14, t: 11, w: -20 },
  { x: 60, s: 3, d: 9, t: 6, w: 12 },
  { x: 69, s: 5, d: 12, t: 3, w: -14 },
  { x: 78, s: 4, d: 10, t: 8, w: 18 },
  { x: 87, s: 6, d: 13, t: 5, w: -10 },
  { x: 94, s: 3, d: 9, t: 10, w: 12 },
  { x: 47, s: 2, d: 7, t: 5, w: -8 },
];

export type Particle = (typeof PARTICLES)[number];

/** What falls in the season animations. */
export const SEASON_ITEMS = {
  leaves: ['🍁', '🍂', '🍃', '🍂'],
  snowfall: ['❄️', '❅', '❆', '•'],
  petals: ['🌸', '💮', '🌸', '🏵️'],
} as const;

/**
 * As many particles as asked for (density 1 = the 12 fixed spots): more are spread between
 * the fixed ones, each round shifted across and in time so they never line up.
 */
export function particleSpots(base: readonly Particle[], density: number): Particle[] {
  const n = Math.max(3, Math.round(base.length * density));
  return Array.from({ length: n }, (_, i) => {
    const p = base[i % base.length]!;
    const round = Math.floor(i / base.length);
    return round
      ? { ...p, x: (p.x + round * 37) % 100, t: p.t + round * 2.7, d: p.d * (1 + round * 0.12) }
      : p;
  });
}
