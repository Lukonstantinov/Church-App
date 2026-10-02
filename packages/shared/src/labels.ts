import { z } from 'zod';

/** How a custom label (or a position's chip) moves. */
export const LABEL_ANIMATIONS = [
  'none',
  'flow',
  'shimmer',
  'pulse',
  'glow',
  'wave',
  'rainbow',
  'bounce',
  'float',
  'heartbeat',
  'flicker',
  'sparkle',
  'jelly',
] as const;
export type LabelAnimation = (typeof LABEL_ANIMATIONS)[number];

/** The fill: one colour, a gradient of 2–5 colours, a rainbow, or a special finish. */
export const LABEL_STYLES = [
  'solid',
  'gradient',
  'rainbow',
  'metal',
  'neon',
  'glass',
  'outline',
] as const;
export type LabelStyle = (typeof LABEL_STYLES)[number];

/** A pattern drawn over the fill. */
export const LABEL_TEXTURES = [
  'none',
  'stripes',
  'dots',
  'sparkle',
  'grain',
  'checks',
  'waves',
] as const;
export type LabelTexture = (typeof LABEL_TEXTURES)[number];

export const LABEL_FONTS = ['default', 'serif', 'mono', 'script', 'rounded', 'condensed'] as const;
export type LabelFont = (typeof LABEL_FONTS)[number];

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** Everything about how a label (or position) looks. */
export const labelLookSchema = z.object({
  color: hex,
  /** Second colour of a gradient (kept for older labels; `colors` holds the full list). */
  color2: hex.nullish(),
  /** All gradient colours in order (2–5). */
  colors: z.array(hex).min(2).max(5).nullish(),
  style: z.enum(LABEL_STYLES).default('solid'),
  animation: z.enum(LABEL_ANIMATIONS).default('none'),
  texture: z.enum(LABEL_TEXTURES).default('none'),
  font: z.enum(LABEL_FONTS).default('default'),
  caps: z.boolean().default(false),
  italic: z.boolean().default(false),
  /** Shown before the name. */
  emoji: z.string().trim().max(8).nullish(),
  /** The person's name itself is drawn in this look too. */
  nameStyle: z.boolean().default(false),
});
export type LabelLookInput = z.input<typeof labelLookSchema>;

export interface LabelLook {
  color: string;
  color2: string | null;
  colors: string[] | null;
  style: LabelStyle;
  animation: LabelAnimation;
  texture: LabelTexture;
  font: LabelFont;
  caps: boolean;
  italic: boolean;
  emoji: string | null;
  nameStyle: boolean;
}

/** The extras stored as JSON next to the label's colour, fill and animation columns. */
export type LabelExtra = Pick<
  LabelLook,
  'colors' | 'texture' | 'font' | 'caps' | 'italic' | 'emoji' | 'nameStyle'
>;

/** A full look from the stored columns and the JSON extras (old rows have no extras). */
export function readLabelLook(
  base: { color: string; color2: string | null; style: string; animation: string },
  extra: Partial<LabelExtra> | null | undefined,
): LabelLook {
  const style = (LABEL_STYLES as readonly string[]).includes(base.style)
    ? (base.style as LabelStyle)
    : 'solid';
  const animation = (LABEL_ANIMATIONS as readonly string[]).includes(base.animation)
    ? (base.animation as LabelAnimation)
    : 'none';
  return {
    color: base.color,
    color2: base.color2,
    colors: extra?.colors ?? (base.color2 ? [base.color, base.color2] : null),
    style,
    animation,
    texture: extra?.texture ?? 'none',
    font: extra?.font ?? 'default',
    caps: extra?.caps ?? false,
    italic: extra?.italic ?? false,
    emoji: extra?.emoji ?? null,
    nameStyle: extra?.nameStyle ?? false,
  };
}

/** The JSON extras of a look (what isn't a column of its own). */
export const labelExtra = (l: z.output<typeof labelLookSchema>): LabelExtra => ({
  colors: l.colors?.map((c) => c.toLowerCase()) ?? null,
  texture: l.texture,
  font: l.font,
  caps: l.caps,
  italic: l.italic,
  emoji: l.emoji || null,
  nameStyle: l.nameStyle,
});
