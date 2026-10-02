import { z } from 'zod';

/** What fills the app's background behind the cards. */
export const APP_BG_SOURCES = ['none', 'theme', 'color'] as const;
export type AppBgSource = (typeof APP_BG_SOURCES)[number];

/** A pattern over the background ("pattern" = the ministry's own pattern, e.g. its logo). */
export const APP_BG_TEXTURES = [
  'none',
  'pattern',
  'dots',
  'grid',
  'waves',
  'stripes',
  'grain',
] as const;
export type AppBgTexture = (typeof APP_BG_TEXTURES)[number];

export const APP_BG_ANIMATIONS = ['none', 'drift', 'aurora', 'breathe'] as const;
export type AppBgAnimation = (typeof APP_BG_ANIMATIONS)[number];

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * The background of the main window (church) or of a ministry's screens: its own look
 * (colour, pattern and photo — the same template as the ministry's cards) or chosen
 * colours, how strong the tint is, a pattern, and a slow movement.
 */
export const appBackgroundSchema = z.object({
  source: z.enum(APP_BG_SOURCES).default('theme'),
  /** For "color": 1–3 colours, blended top to bottom. */
  colors: z.array(hex).min(1).max(3).nullish(),
  /** How strong the tint is (0 = barely, 1 = full colour). */
  strength: z.number().min(0.05).max(1).default(0.35),
  texture: z.enum(APP_BG_TEXTURES).default('none'),
  animation: z.enum(APP_BG_ANIMATIONS).default('none'),
});
export type AppBackgroundInput = z.input<typeof appBackgroundSchema>;
export type AppBackground = z.output<typeof appBackgroundSchema>;
