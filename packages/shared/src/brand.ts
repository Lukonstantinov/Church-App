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

/**
 * A ministry's background pattern: one icon repeated over its colours.
 * - `kind`: a ready-made shape, any emoji, or the ministry's logo
 * - `size`: tile size in px (smaller = denser); `opacity` 0.05–0.8; `angle` −45…45°
 */
export interface PatternConfig {
  kind: 'preset' | 'emoji' | 'logo';
  value: string;
  size: number;
  opacity: number;
  angle: number;
}

export const DEFAULT_PATTERN: PatternConfig = {
  kind: 'emoji',
  value: '✝️',
  size: 44,
  opacity: 0.18,
  angle: -20,
};

/** Emoji may be several code points (flags, ZWJ sequences) but never markup. */
const SAFE_EMOJI = /^[^<>&"'\s]{1,16}$/u;

export const patternSchema = z
  .object({
    kind: z.enum(['preset', 'emoji', 'logo']),
    value: z.string().max(16),
    size: z.number().min(16).max(120),
    opacity: z.number().min(0.03).max(0.8),
    angle: z.number().min(-45).max(45),
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
 * CSS for the repeating layer. Emoji and shapes become an SVG tile; the logo is used
 * as an image. Tilt is applied by rotating an oversized layer (see PatternLayer).
 */
export function patternBackground(
  p: PatternConfig,
  logoUrl?: string | null,
): { image: string; size: string } | null {
  const s = Math.round(p.size);
  if (p.kind === 'logo') {
    return logoUrl ? { image: `url("${logoUrl}")`, size: `${Math.round(s * 0.6)}px` } : null;
  }
  let svg: string;
  if (p.kind === 'preset') {
    const tile = TILES[p.value as PatternKey];
    if (!tile) return null;
    // Scale the preset tile to the chosen size.
    svg = tile.replace(/width='(\d+)' height='(\d+)'/, (_m, w: string, h: string) => {
      const k = s / Number(w);
      return `width='${s}' height='${Math.round(Number(h) * k)}' viewBox='0 0 ${w} ${h}'`;
    });
  } else {
    const fs = Math.round(s * 0.55);
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-size='${fs}' font-family='Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif'>${p.value}</text></svg>`;
  }
  return { image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size: `${s}px` };
}
