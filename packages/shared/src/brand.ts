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
} as const;

export type BrandColor = keyof typeof BRAND_COLORS;
export const BRAND_COLOR_KEYS = Object.keys(BRAND_COLORS) as BrandColor[];
export const DEFAULT_BRAND: BrandColor = 'blue';

/** Stable per-group accent (for the dot next to a group name). */
export function groupColor(groupId: number): string {
  const keys = BRAND_COLOR_KEYS.filter((k) => k !== 'slate');
  return BRAND_COLORS[keys[Math.abs(groupId) % keys.length]!].light;
}
