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
