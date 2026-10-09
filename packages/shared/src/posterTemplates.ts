import { z } from 'zod';
import { MAX_EFFECTS, MEETING_MOTIONS, motionTuneSchema } from './motions';
import { isFontKey } from './posts';

/**
 * Poster templates (Design → Posters): a background and layers on top of it, front last —
 * pictures (PNG/WebP keep their transparency), texts filled in from the event or meeting
 * (title, date, time, place, topic or own words), colour and gradient layers (a gradient
 * can move) and effect layers (any animation, drawn over everything below it). Pictures,
 * texts and colour layers can wear effects of their own; pictures and colour layers have
 * a shape with soft edges; the poster can have a frame. Positions are relative, so one design fits the poster, the
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

/** A layer's outline: plain, rounded corners, a circle or an oval (it fits the box). */
export const LAYER_SHAPES = ['rect', 'rounded', 'circle', 'oval'] as const;
export type LayerShape = (typeof LAYER_SHAPES)[number];
const edge = {
  shape: z.enum(LAYER_SHAPES).nullish(),
  /** Soft edges: 0 sharp … 1 fading out from the middle. */
  soft: z.number().min(0).max(1).nullish(),
};
const layerEffects = z
  .array(z.object({ kind: z.enum(MEETING_MOTIONS), tune: motionTuneSchema.nullish() }))
  .max(MAX_EFFECTS)
  .nullish();

/** How a colour layer moves: not at all, its colours slide, turn round or breathe. */
export const FILL_MOVES = ['none', 'flow', 'spin', 'pulse'] as const;
export type FillMove = (typeof FILL_MOVES)[number];

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
    /**
     * The whole photo a cut-out (or a background with the people removed) was made from:
     * the eraser's "bring back" brush paints it back in. With its signed link on reading.
     */
    source: z.number().int().positive().nullish(),
    sourceUrl: z.string().max(600).nullish(),
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
    effects: layerEffects,
    ...edge,
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
    /** Effects on the words only: inside the letters, or in a soft cloud around them. */
    effects: layerEffects,
    fxIn: z.enum(['letters', 'around']).nullish(),
  }),
  z.object({
    type: z.literal('fill'),
    ...common,
    x: place.x,
    y: place.y,
    rotate: place.rotate,
    /** Width and height in % of the poster (100 × 100 covers it). */
    w: z.number().min(2).max(300).default(100),
    h: z.number().min(2).max(300).default(100),
    paint: z.enum(['color', 'linear', 'radial']).default('linear'),
    colors: z.array(hex).min(1).max(4).default(['#e8402c', '#7a1410']),
    angle: z.number().int().min(0).max(360).default(135),
    move: z.enum(FILL_MOVES).nullish(),
    /** 1 = as designed; 0.25 (slow) … 3 (fast). */
    speed: z.number().min(0.25).max(3).nullish(),
    effects: layerEffects,
    ...edge,
  }),
  z.object({
    type: z.literal('effect'),
    ...common,
    kind: z.enum(MEETING_MOTIONS),
    tune: motionTuneSchema.nullish(),
    /** Fades out towards the poster's edges instead of being cut off (0 … 1). */
    fade: z.number().min(0).max(1).nullish(),
    /** Its box when moved or resized (centre and size in % of the poster); none = all of it. */
    x: z.number().min(-50).max(150).nullish(),
    y: z.number().min(-50).max(150).nullish(),
    w: z.number().min(5).max(300).nullish(),
    h: z.number().min(5).max(300).nullish(),
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

/** A frame drawn round the poster on top of everything (sizes in % of its smaller side). */
export const posterFrameSchema = z.object({
  width: z.number().min(0.2).max(8).default(1.2),
  color: hex.default('#ffffff'),
  /** How far in from the poster's edge. */
  inset: z.number().min(0).max(12).default(3),
  radius: z.number().min(0).max(30).default(0),
  glow: hex.nullish(),
  /** A second thin line inside the first. */
  double: z.boolean().nullish(),
});
export type PosterFrame = z.output<typeof posterFrameSchema>;

/** How many layers a poster can have. */
export const MAX_POSTER_LAYERS = 20;

export const posterTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  background: posterBackgroundSchema,
  layers: z.array(posterLayerSchema).max(MAX_POSTER_LAYERS),
  frame: posterFrameSchema.nullish(),
});
export type PosterTemplateInput = z.input<typeof posterTemplateInputSchema>;

export interface PosterTemplate {
  id: number;
  name: string;
  background: PosterBackground;
  layers: PosterLayer[];
  frame: PosterFrame | null;
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
