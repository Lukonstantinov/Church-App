import { z } from 'zod';
import { MAX_EFFECTS, MEETING_MOTIONS, motionTuneSchema } from './motions';
import { isFontKey } from './posts';

/**
 * Poster templates (Design → Posters): a background and layers on top of it, front last —
 * pictures (PNG/WebP keep their transparency), texts filled in from the event or meeting
 * (title, date, time, place, topic or own words) and effect layers (any animation, drawn
 * over everything below it). Positions are relative, so one design fits the poster, the
 * home tile and the screen alike: x/y = the centre in % of the box, size in % of its
 * smaller side.
 */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'color-dodge',
  'color-burn',
  'lighten',
  'darken',
  'difference',
  'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Layer styles, as in Photoshop: drop shadow, outer glow, stroke, bevel. */
export const layerStyleSchema = z.object({
  /** Drop shadow strength (0 none … 1 strong). */
  shadow: z.number().min(0).max(1).nullish(),
  /** Outer glow colour. */
  glow: hex.nullish(),
  /** Stroke (outline) colour and width in px at poster size. */
  stroke: hex.nullish(),
  strokeWidth: z.number().min(0).max(12).nullish(),
  /** Bevel and emboss: lit from the top left. */
  bevel: z.boolean().nullish(),
});
export type LayerStyle = z.output<typeof layerStyleSchema>;

const common = {
  id: z.string().min(1).max(24),
  hidden: z.boolean().nullish(),
  opacity: z.number().min(0).max(1).nullish(),
  blend: z.enum(BLEND_MODES).nullish(),
};
const place = {
  x: z.number().min(-50).max(150).default(50),
  y: z.number().min(-50).max(150).default(50),
  size: z.number().min(2).max(300).default(60),
  rotate: z.number().int().min(-180).max(180).default(0),
};

export const TEXT_SOURCES = ['title', 'date', 'time', 'place', 'topic', 'custom'] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];

export const posterLayerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    ...common,
    ...place,
    mediaId: z.number().int().positive(),
    /** Filled by the server when reading (a signed link). */
    url: z.string().max(600).nullish(),
    style: layerStyleSchema.nullish(),
    /**
     * "cover" fills the whole box like a background photo, so it lines up the same in the
     * poster, the tile and the screen: x/y then pick the part kept in view (0–100) and
     * size zooms in (100 = just fills). "free" (default) places it like a sticker.
     */
    fit: z.enum(['free', 'cover']).nullish(),
    /** The picture's width ÷ height, so its box (and effects on it) has its exact shape. */
    ratio: z.number().min(0.05).max(20).nullish(),
    /** It has see-through parts: effects on it follow its outline. */
    cutout: z.boolean().nullish(),
    /** Effects on the picture itself (drawn inside its outline, the photo effects change it). */
    effects: z
      .array(z.object({ kind: z.enum(MEETING_MOTIONS), tune: motionTuneSchema.nullish() }))
      .max(MAX_EFFECTS)
      .nullish(),
  }),
  z.object({
    type: z.literal('text'),
    ...common,
    ...place,
    source: z.enum(TEXT_SOURCES).default('title'),
    /** The words for "custom" (and a fallback when the event has no such field). */
    text: z.string().max(160).nullish(),
    font: z.string().max(40).refine(isFontKey, 'font').nullish(),
    color: hex.nullish(),
    align: z.enum(['left', 'center', 'right']).nullish(),
    weight: z.union([z.literal(400), z.literal(700), z.literal(900)]).nullish(),
    upper: z.boolean().nullish(),
    style: layerStyleSchema.nullish(),
  }),
  z.object({
    type: z.literal('effect'),
    ...common,
    kind: z.enum(MEETING_MOTIONS),
    tune: motionTuneSchema.nullish(),
  }),
]);
export type PosterLayer = z.output<typeof posterLayerSchema>;
export type PosterLayerInput = z.input<typeof posterLayerSchema>;

export const posterBackgroundSchema = z.object({
  /** Colour, gradient, an own photo, or the event's own cover photo. */
  type: z.enum(['color', 'gradient', 'photo', 'cover']).default('gradient'),
  colors: z.array(hex).min(1).max(3).default(['#e8402c', '#7a1410']),
  angle: z.number().int().min(0).max(360).default(160),
  mediaId: z.number().int().positive().nullish(),
  url: z.string().max(600).nullish(),
  /** Darkens a photo so layers on top stand out (0 … 0.8). */
  dim: z.number().min(0).max(0.8).nullish(),
});
export type PosterBackground = z.output<typeof posterBackgroundSchema>;

export const posterTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  background: posterBackgroundSchema,
  layers: z.array(posterLayerSchema).max(12),
});
export type PosterTemplateInput = z.input<typeof posterTemplateInputSchema>;

export interface PosterTemplate {
  id: number;
  name: string;
  background: PosterBackground;
  layers: PosterLayer[];
  mine: boolean;
}

/** What the text layers say, taken from the event or meeting the poster is on. */
export interface PosterTexts {
  title: string;
  date: string;
  time: string;
  place: string | null;
  topic: string | null;
}
