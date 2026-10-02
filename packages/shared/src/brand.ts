import { z } from 'zod';

/**
 * Church brand colors. Every swatch keeps white button text readable (≥4.5:1) and has
 * a lighter step for accents on dark backgrounds, plus a partner hue for the gradient.
 */
export const BRAND_COLORS = {
  blue: { light: '#2563eb', dark: '#7fb0ff', partner: '#7c3aed' },
  indigo: { light: '#4f46e5', dark: '#a5a3ff', partner: '#db2777' },
  violet: { light: '#7c3aed', dark: '#c4a7ff', partner: '#2563eb' },
  rose: { light: '#be185d', dark: '#ff8fc0', partner: '#7c3aed' },
  red: { light: '#dc2626', dark: '#ff8a80', partner: '#ea580c' },
  orange: { light: '#c2410c', dark: '#ffab70', partner: '#db2777' },
  green: { light: '#15803d', dark: '#6fdc95', partner: '#0e7490' },
  teal: { light: '#0f766e', dark: '#5fd6c7', partner: '#2563eb' },
  slate: { light: '#334155', dark: '#b4c2d6', partner: '#6366f1' },
  // Two-tone gradient themes.
  sunset: { light: '#be123c', dark: '#fda4af', partner: '#ea580c' },
  ocean: { light: '#0369a1', dark: '#7dd3fc', partner: '#0f766e' },
  forest: { light: '#166534', dark: '#86efac', partner: '#4d7c0f' },
  lavender: { light: '#6d28d9', dark: '#d8b4fe', partner: '#db2777' },
  night: { light: '#1e293b', dark: '#a5b4fc', partner: '#4338ca' },
  gold: { light: '#a16207', dark: '#fcd34d', partner: '#c2410c' },
  berry: { light: '#9d174d', dark: '#f9a8d4', partner: '#6d28d9' },
  mint: { light: '#047857', dark: '#6ee7b7', partner: '#0891b2' },
  sky: { light: '#1d4ed8', dark: '#93c5fd', partner: '#0891b2' },
  fire: { light: '#b91c1c', dark: '#fca5a5', partner: '#d97706' },
  aurora: { light: '#0f766e', dark: '#5eead4', partner: '#7c3aed' },
  coffee: { light: '#78350f', dark: '#e7b98a', partner: '#9a3412' },
} as const;

export type BrandColor = keyof typeof BRAND_COLORS;
export const BRAND_COLOR_KEYS = Object.keys(BRAND_COLORS) as BrandColor[];
export const DEFAULT_BRAND: BrandColor = 'blue';

export interface BrandSwatch {
  light: string;
  dark: string;
  partner: string;
}

/** A theme is a palette key or a custom "#rrggbb" colour. */
export type BrandValue = BrandColor | `#${string}`;
export const isBrandValue = (v: unknown): v is BrandValue =>
  typeof v === 'string' && (v in BRAND_COLORS || /^#[0-9a-f]{6}$/i.test(v));

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function toHex(c: [number, number, number]) {
  return `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * t) as [number, number, number]);
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Contrast ratio of white text on `hex`. */
export const whiteContrast = (hex: string) => 1.05 / (luminance(hex) + 0.05);

/**
 * Palette for any theme value. Custom colours are darkened until white text stays
 * readable (≥ 4.5:1); the accent for dark mode and the gradient partner are derived.
 */
export function resolveBrand(value: string | null | undefined): BrandSwatch {
  if (value && value in BRAND_COLORS) return BRAND_COLORS[value as BrandColor];
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return BRAND_COLORS[DEFAULT_BRAND];
  let light = value.toLowerCase();
  for (let i = 0; i < 12 && whiteContrast(light) < 4.5; i++) light = mix(light, '#000000', 0.12);
  const [r, g, b] = rgb(light);
  // Partner: the same colour rotated towards violet/pink for a soft gradient.
  const partner = toHex([b * 0.6 + r * 0.4, r * 0.35 + g * 0.3, g * 0.5 + b * 0.5]);
  return { light, dark: mix(light, '#ffffff', 0.5), partner: mix(partner, light, 0.35) };
}

/** Stable per-group accent (for the dot next to a group name). */
/** Distinct themes handed to new ministries in turn, so each has its own colour. */
export const MINISTRY_PALETTE: BrandColor[] = [
  'ocean',
  'sunset',
  'forest',
  'lavender',
  'gold',
  'berry',
  'teal',
  'fire',
  'sky',
  'mint',
  'coffee',
  'aurora',
  'indigo',
  'rose',
  'orange',
  'green',
  'violet',
  'red',
  'blue',
  'night',
];

/** The first palette theme no other ministry (nor the church) uses yet. */
export function pickMinistryColor(taken: (string | null)[], avoid?: string | null): BrandColor {
  const used = new Set<string | null | undefined>([...taken, avoid]);
  return (
    MINISTRY_PALETTE.find((k) => !used.has(k)) ??
    MINISTRY_PALETTE[taken.length % MINISTRY_PALETTE.length]!
  );
}

export function groupColor(groupId: number, theme?: string | null): string {
  if (theme) return resolveBrand(theme).light;
  const keys = BRAND_COLOR_KEYS.filter((k) => k !== 'slate');
  return BRAND_COLORS[keys[Math.abs(groupId) % keys.length]!].light;
}

/**
 * Decorative patterns drawn in white over a ministry's colours (cards, hero blocks).
 * Each is a small repeating SVG tile.
 */
const TILES = {
  dots: `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><circle cx='3' cy='3' r='1.6' fill='#fff'/></svg>`,
  grid: `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><path d='M22 0H0v22' fill='none' stroke='#fff' stroke-width='1'/></svg>`,
  diagonal: `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><path d='M-2 16L16 -2M-2 2L2 -2M12 16L16 12' stroke='#fff' stroke-width='1.6'/></svg>`,
  waves: `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='16'><path d='M0 8q10-8 20 0t20 0' fill='none' stroke='#fff' stroke-width='1.6'/></svg>`,
  circles: `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><circle cx='22' cy='22' r='14' fill='none' stroke='#fff' stroke-width='1.5'/></svg>`,
  crosses: `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26'><path d='M13 7v12M8 11h10' stroke='#fff' stroke-width='1.8' stroke-linecap='round'/></svg>`,
  stars: `<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'><path d='M9 4l1.4 3 3.1.4-2.3 2.1.6 3.1L9 11.1 6.2 12.6l.6-3.1L4.5 7.4l3.1-.4zM26 20l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z' fill='#fff'/></svg>`,
  hearts: `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><path d='M15 21s-6-3.7-6-8a3.3 3.3 0 016-2 3.3 3.3 0 016 2c0 4.3-6 8-6 8z' fill='none' stroke='#fff' stroke-width='1.5'/></svg>`,
  confetti: `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect x='5' y='6' width='5' height='2' rx='1' fill='#fff' transform='rotate(30 7 7)'/><rect x='26' y='12' width='5' height='2' rx='1' fill='#fff' transform='rotate(-40 28 13)'/><circle cx='14' cy='28' r='1.6' fill='#fff'/><rect x='30' y='30' width='5' height='2' rx='1' fill='#fff' transform='rotate(70 32 31)'/></svg>`,
} as const;

export type PatternKey = keyof typeof TILES;
export const PATTERN_KEYS = Object.keys(TILES) as PatternKey[];

export const PATTERN_LAYOUTS = [
  'grid',
  'checker',
  'brick',
  'domino',
  'honeycomb',
  'scatter',
] as const;
export type PatternLayout = (typeof PATTERN_LAYOUTS)[number];
export const PATTERN_ALTERNATES = ['none', 'rotate', 'mirror', 'size'] as const;
export type PatternAlternate = (typeof PATTERN_ALTERNATES)[number];

/**
 * A ministry's background pattern: one icon repeated over its colours.
 * - `kind`/`value`: a ready-made shape, any emoji, or the ministry's logo
 * - `size`: cell size in px; `scale`: icon size within its cell (spacing)
 * - `layout`: grid, checkers, bricks, dominoes, honeycomb or scatter
 * - `angle`: tilt of the whole pattern; `iconAngle`: rotation of each icon
 * - `alternate`: every other icon flipped, mirrored or smaller
 * - `opacity` of the icons; `shade`: darkens (<0) or lightens (>0) the whole block
 */
export interface PatternConfig {
  kind: 'preset' | 'emoji' | 'logo';
  value: string;
  size: number;
  opacity: number;
  angle: number;
  layout?: PatternLayout;
  scale?: number;
  iconAngle?: number;
  alternate?: PatternAlternate;
  shade?: number;
}

export const DEFAULT_PATTERN: PatternConfig = {
  kind: 'emoji',
  value: '✝️',
  size: 44,
  opacity: 0.18,
  angle: -20,
  layout: 'grid',
  scale: 0.6,
  iconAngle: 0,
  alternate: 'none',
  shade: 0,
};

/** Emoji may be several code points (flags, ZWJ sequences) but never markup. */
const SAFE_EMOJI = /^[^<>&"'\s]{1,16}$/u;

export const patternSchema = z
  .object({
    kind: z.enum(['preset', 'emoji', 'logo']),
    value: z.string().max(16),
    size: z.number().min(16).max(160),
    opacity: z.number().min(0.03).max(1),
    angle: z.number().min(-90).max(90),
    layout: z.enum(PATTERN_LAYOUTS).optional(),
    scale: z.number().min(0.2).max(1.2).optional(),
    iconAngle: z.number().min(-180).max(180).optional(),
    alternate: z.enum(PATTERN_ALTERNATES).optional(),
    shade: z.number().min(-0.7).max(0.7).optional(),
  })
  .refine(
    (p) => p.kind === 'logo' || (p.kind === 'preset' ? p.value in TILES : SAFE_EMOJI.test(p.value)),
    'pattern',
  );

/** Parses a stored pattern (JSON) defensively; null when absent or invalid. */
export function readPattern(raw: unknown): PatternConfig | null {
  if (!raw) return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = patternSchema.safeParse(v);
  return r.success ? r.data : null;
}

/**
 * A photo behind a ministry card: over the whole card, or on one part of it (a half,
 * a third…) with the colours and pattern on the rest. Focus and zoom pick the part of
 * the photo that shows; `dim` darkens (negative) or lightens it; `soft` feathers the edge.
 */
export const BACKDROP_SPLITS = [
  'full',
  'left',
  'right',
  'top',
  'bottom',
  'diagonal',
  'diagonal2',
] as const;
export type BackdropSplit = (typeof BACKDROP_SPLITS)[number];

export interface BackdropConfig {
  mediaId: number;
  split: BackdropSplit;
  /** Share of the card the photo covers (ignored for 'full'). */
  amount: number;
  focusX: number;
  focusY: number;
  zoom: number;
  dim: number;
  soft: number;
  /** How strongly the theme colour tints the photo (0 = untouched photo). */
  tint: number;
}

export const DEFAULT_BACKDROP: Omit<BackdropConfig, 'mediaId'> = {
  split: 'full',
  amount: 0.5,
  focusX: 50,
  focusY: 50,
  zoom: 1,
  dim: -0.25,
  soft: 0.12,
  tint: 0.55,
};

export const backdropSchema = z.object({
  mediaId: z.number().int().positive(),
  split: z.enum(BACKDROP_SPLITS),
  amount: z.number().min(0.2).max(0.8),
  focusX: z.number().min(0).max(100),
  focusY: z.number().min(0).max(100),
  zoom: z.number().min(1).max(3),
  dim: z.number().min(-0.8).max(0.7),
  soft: z.number().min(0).max(0.4),
  // Photos saved before the tint existed pick up the theme colour too.
  tint: z.number().min(0).max(1).default(0.55),
});

/** Parses a stored backdrop (JSON) defensively; null when absent or invalid. */
export function readBackdrop(raw: unknown): BackdropConfig | null {
  if (!raw) return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = backdropSchema.safeParse(v);
  return r.success ? r.data : null;
}

/**
 * Where the photo sits (percent box inside the card) and the CSS mask that fades it
 * into the rest. The box is the photo's part plus room for the soft edge.
 */
export function backdropGeometry(b: Pick<BackdropConfig, 'split' | 'amount' | 'soft'>): {
  box: { left: number; top: number; width: number; height: number };
  mask: string | null;
} {
  const a = b.amount * 100;
  const s = b.soft * 50;
  const fade = (dir: string, at: number) =>
    `linear-gradient(${dir}, #000 ${Math.max(0, at - s).toFixed(1)}%, transparent ${Math.min(100, at + s).toFixed(1)}%)`;
  const reach = Math.min(100, a + s);
  switch (b.split) {
    case 'full':
      return { box: { left: 0, top: 0, width: 100, height: 100 }, mask: null };
    case 'left':
      return { box: { left: 0, top: 0, width: reach, height: 100 }, mask: fade('to right', a) };
    case 'right':
      return {
        box: { left: 100 - reach, top: 0, width: reach, height: 100 },
        mask: fade('to left', a),
      };
    case 'top':
      return { box: { left: 0, top: 0, width: 100, height: reach }, mask: fade('to bottom', a) };
    case 'bottom':
      return {
        box: { left: 0, top: 100 - reach, width: 100, height: reach },
        mask: fade('to top', a),
      };
    case 'diagonal':
      return { box: { left: 0, top: 0, width: 100, height: 100 }, mask: fade('135deg', a) };
    case 'diagonal2':
      return { box: { left: 0, top: 0, width: 100, height: 100 }, mask: fade('225deg', a) };
  }
}

/** Icon markup centred on (0,0), `d` px wide. */
function iconMarkup(p: PatternConfig, d: number, logoDataUrl?: string | null): string | null {
  if (p.kind === 'logo') {
    if (!logoDataUrl) return null;
    return `<image href='${logoDataUrl}' x='${-d / 2}' y='${-d / 2}' width='${d}' height='${d}' preserveAspectRatio='xMidYMid meet'/>`;
  }
  if (p.kind === 'preset') {
    const tile = TILES[p.value as PatternKey];
    if (!tile) return null;
    const m = /width='(\d+)' height='(\d+)'>([\s\S]*)<\/svg>$/.exec(tile);
    if (!m) return null;
    return `<svg x='${-d / 2}' y='${-d / 2}' width='${d}' height='${d}' viewBox='0 0 ${m[1]} ${m[2]}' overflow='visible'>${m[3]}</svg>`;
  }
  return `<text x='0' y='0' dominant-baseline='central' text-anchor='middle' font-size='${Math.round(d * 0.9)}' font-family='Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif'>${p.value}</text>`;
}

/** Icon centres (in cells) and tile size (in cells) for each layout. */
function layoutPoints(layout: PatternLayout): {
  w: number;
  h: number;
  pts: [number, number, number?, number?][];
} {
  switch (layout) {
    case 'checker':
      return {
        w: 2,
        h: 2,
        pts: [
          [0.5, 0.5],
          [1.5, 1.5],
        ],
      };
    case 'brick':
      return {
        w: 1,
        h: 2,
        pts: [
          [0.5, 0.5],
          [0, 1.5],
          [1, 1.5],
        ],
      };
    case 'domino':
      return {
        w: 3,
        h: 2,
        pts: [
          [0.5, 0.5],
          [1.5, 0.5],
          [0, 1.5],
          [2, 1.5],
          [3, 1.5],
        ],
      };
    case 'honeycomb':
      return {
        w: 1,
        h: 1.732,
        pts: [
          [0.5, 0.433],
          [0, 1.299],
          [1, 1.299],
        ],
      };
    case 'scatter':
      // Fixed "random" spots: [x, y, extra rotation, size factor].
      return {
        w: 3,
        h: 3,
        pts: [
          [0.45, 0.5, -18, 1],
          [1.7, 0.35, 32, 0.75],
          [2.55, 1.25, -40, 1.1],
          [1.15, 1.45, 12, 0.85],
          [0.35, 2.35, 48, 0.8],
          [1.85, 2.5, -8, 1],
        ],
      };
    default:
      return { w: 1, h: 1, pts: [[0.5, 0.5]] };
  }
}

/**
 * CSS for the repeating layer: one SVG tile with the icons placed by the layout.
 * The logo must be passed as a data: URL (an SVG used as a background can't load
 * other URLs). Tilt is applied by rotating an oversized layer (see PatternLayer).
 */
export function patternBackground(
  p: PatternConfig,
  logoDataUrl?: string | null,
): { image: string; size: string; width: number; height: number } | null {
  const cell = Math.round(p.size);
  const d = Math.max(4, Math.round(cell * (p.scale ?? 0.6)));
  const icon = iconMarkup(p, d, logoDataUrl);
  if (!icon) return null;
  const { w, h, pts } = layoutPoints(p.layout ?? 'grid');
  const W = Math.round(w * cell);
  const H = Math.round(h * cell);
  const alt = p.alternate ?? 'none';
  const uses = pts
    .map(([x, y, rot = 0, k = 1], i) => {
      const odd = i % 2 === 1;
      const r = (p.iconAngle ?? 0) + rot + (alt === 'rotate' && odd ? 180 : 0);
      const sx = (alt === 'mirror' && odd ? -1 : 1) * (alt === 'size' && odd ? 0.6 : 1) * k;
      const sy = (alt === 'size' && odd ? 0.6 : 1) * k;
      return `<g transform='translate(${(x * cell).toFixed(1)} ${(y * cell).toFixed(1)}) rotate(${r}) scale(${sx} ${sy})'><use href='#i'/></g>`;
    })
    .join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><defs><g id='i'>${icon}</g></defs>${uses}</svg>`;
  return {
    image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    size: `${W}px ${H}px`,
    width: W,
    height: H,
  };
}

/** Text on a ministry's coloured blocks: automatic, light, dark or a custom colour. */
export type TextColor = 'auto' | 'light' | 'dark' | `#${string}`;
export const isTextColor = (v: unknown): v is TextColor =>
  v === 'auto' ||
  v === 'light' ||
  v === 'dark' ||
  (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));

export function resolveTextColor(v: string | null | undefined): string {
  if (v === 'dark') return '#111418';
  if (v && /^#[0-9a-f]{6}$/i.test(v)) return v;
  return '#ffffff';
}

/** Opening animations a ministry can choose. */
export const ENTER_ANIMATIONS = [
  'rise',
  'fade',
  'slide',
  'zoom',
  'flip',
  'blur',
  'bounce',
  'none',
] as const;
export type EnterAnimation = (typeof ENTER_ANIMATIONS)[number];
