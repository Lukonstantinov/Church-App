import { z } from 'zod';
import { MEETING_MOTIONS, motionTuneSchema, type MotionTune } from './motions';
import { ENTER_ANIMATIONS } from './brand';
import { appBackgroundSchema } from './background';
import { isFontKey } from './posts';

/**
 * The parts of a screen the designer styles in the Design studio, by tapping them on a
 * live copy of the screen. The church's main page and each ministry's page have their own.
 */
export const CHURCH_MODULES = ['header', 'cards', 'list'] as const;
export const MINISTRY_MODULES = [
  'header',
  'actions',
  'calendar',
  'meetings',
  'posts',
  'tabbar',
] as const;
export type ChurchModule = (typeof CHURCH_MODULES)[number];
export type MinistryModule = (typeof MINISTRY_MODULES)[number];
export type ScreenModule = ChurchModule | MinistryModule;

/**
 * How a part's blocks are filled: as the app draws them, frosted glass, liquid glass (deep
 * blur with a moving shine), the colour, an own gradient (`colors`), flowing colours, dark,
 * or dark with a burning edge.
 */
export const MODULE_SURFACES = [
  'default',
  'glass',
  'liquid',
  'brand',
  'gradient',
  'fluid',
  'dark',
  'fire',
] as const;
export type ModuleSurface = (typeof MODULE_SURFACES)[number];

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * The edge of a part's blocks: none, liquid (the corners slowly morph), metallic, gold,
 * neon glow, a turning rainbow, burning, or a bright glass rim.
 */
export const MODULE_EDGES = [
  'none',
  'liquid',
  'metal',
  'gold',
  'neon',
  'rainbow',
  'fire',
  'glass',
] as const;
export type ModuleEdge = (typeof MODULE_EDGES)[number];

/**
 * Light passing over a part: none, a soft wide glow drifting across, a thin bright glint now
 * and then, an iridescent (holographic) shimmer, or tiny twinkling sparkles.
 */
export const MODULE_SHINES = ['none', 'soft', 'glint', 'holo', 'sparkle'] as const;
export type ModuleShine = (typeof MODULE_SHINES)[number];

/** A picture under a part's content (ministries: an uploaded photo), see-through. */
export const modulePhotoSchema = z.object({
  mediaId: z.number().int().positive(),
  /** Filled by the server when reading (a signed link). */
  url: z.string().max(600).nullish(),
  /** 0.05 (faint) … 1 (full). */
  opacity: z.number().min(0.05).max(1).default(0.35),
  /** The spot of the picture kept in view, in % across and down. */
  focusX: z.number().min(0).max(100).nullish(),
  focusY: z.number().min(0).max(100).nullish(),
  /** 0.5 (smaller) … 3 (zoomed in). */
  zoom: z.number().min(0.5).max(3).nullish(),
  /** Fill the area (cut to fit) or show the whole picture. */
  fit: z.enum(['cover', 'contain']).nullish(),
  /** Only part of the block: a half on one side (the other half can hold a second picture). */
  split: z.enum(['full', 'left', 'right', 'top', 'bottom']).nullish(),
});
export type ModulePhoto = z.output<typeof modulePhotoSchema>;

/** The light passing over a part: how strong, how fast, and at what slant. */
export const shineTuneSchema = z.object({
  strength: z.number().min(0.2).max(1).nullish(),
  speed: z.number().min(0.25).max(3).nullish(),
  /** Slant of the light in degrees (the designed slant is about 115). */
  angle: z.number().int().min(0).max(180).nullish(),
});
export type ShineTune = z.output<typeof shineTuneSchema>;

/** What the icon animations show: an emoji, the logo, or an uploaded picture. */
export const motionIconSchema = z.object({
  emoji: z.string().trim().max(8).nullish(),
  mediaId: z.number().int().positive().nullish(),
  /** Filled by the server when reading (a signed link to the picture). */
  url: z.string().max(600).nullish(),
});
export type MotionIcon = z.output<typeof motionIconSchema>;

export const moduleLookSchema = z.object({
  /** A living animation inside the part's blocks; null/absent = none. */
  motion: z.enum(MEETING_MOTIONS).nullish(),
  /** More animations drawn on top of it, like layers (up to three in all). */
  layers: z.array(z.enum(MEETING_MOTIONS)).max(2).nullish(),
  surface: z.enum(MODULE_SURFACES).nullish(),
  /** The "gradient" surface: 2–5 colours in order, like a role chip. */
  colors: z.array(hex).min(2).max(5).nullish(),
  /** Direction of that gradient, in degrees. */
  angle: z.number().int().min(0).max(360).nullish(),
  /** The gradient's colours flow slowly along it. */
  flow: z.boolean().nullish(),
  /** Tuning for all its animations (older saves), see `tunes`. */
  tune: motionTuneSchema.nullish(),
  /** Each animation's own tuning (main one and layers), by animation. */
  tunes: z.partialRecord(z.enum(MEETING_MOTIONS), motionTuneSchema).nullish(),
  icon: motionIconSchema.nullish(),
  /** Meetings: the tile has its own animation instead of the meeting screen's. */
  own: z.boolean().nullish(),
  edge: z.enum(MODULE_EDGES).nullish(),
  shine: z.enum(MODULE_SHINES).nullish(),
  shineTune: shineTuneSchema.nullish(),
  photo: modulePhotoSchema.nullish(),
  /** With a split picture: a second one in the other half. */
  photo2: modulePhotoSchema.nullish(),
  /** The quick buttons' icon squares: size, roundness and fill. */
  chip: z
    .object({
      size: z.number().min(0.6).max(1.4).nullish(),
      radius: z.number().int().min(0).max(24).nullish(),
      fill: z.enum(['brand', 'glass', 'dark', 'white', 'none']).nullish(),
    })
    .nullish(),
  /** Corner roundness of the part's blocks in px: 0 = square … 40 = very round. */
  radius: z.number().int().min(0).max(40).nullish(),
  /** Text size of the part: 0.7 (smaller, long names fit) … 1.3 (bigger). */
  textScale: z.number().min(0.7).max(1.3).nullish(),
  /** A font for the part's text (a key of FONTS). */
  font: z.string().max(40).refine(isFontKey, 'font').nullish(),
});
export type ModuleLook = z.output<typeof moduleLookSchema>;

/** The tuning one of a part's animations uses: its own, else the part's shared one. */
export const tuneFor = (
  look: Pick<ModuleLook, 'tune' | 'tunes'> | null | undefined,
  kind: (typeof MEETING_MOTIONS)[number] | null | undefined,
): MotionTune | null => (kind && look?.tunes?.[kind]) || look?.tune || null;

const allModules = [...new Set<string>([...CHURCH_MODULES, ...MINISTRY_MODULES])] as [
  string,
  ...string[],
];
export const screenLookSchema = z.partialRecord(z.enum(allModules), moduleLookSchema);
export type ScreenLook = Partial<Record<ScreenModule, ModuleLook>>;

/** Reads a stored screen look, dropping anything unknown. */
export function readScreenLook(v: unknown): ScreenLook {
  const parsed = screenLookSchema.safeParse(v ?? {});
  return parsed.success ? (parsed.data as ScreenLook) : {};
}

/** The Design studio saves a ministry's page: its parts, entrance, meeting animation, background. */
export const ministryStudioSchema = z.object({
  screenLook: screenLookSchema.optional(),
  animation: z.enum(ENTER_ANIMATIONS).optional(),
  meetingMotion: z.enum(MEETING_MOTIONS).nullable().optional(),
  pageBackground: appBackgroundSchema.nullable().optional(),
});
export type MinistryStudioInput = z.input<typeof ministryStudioSchema>;

/** The Design studio saves the church's main page: its parts and background. */
export const churchStudioSchema = z.object({
  screenLook: screenLookSchema.optional(),
  appBackground: appBackgroundSchema.nullable().optional(),
  /** The same background on every ministry's pages too (the whole app). */
  everywhere: z.boolean().optional(),
});
export type ChurchStudioInput = z.input<typeof churchStudioSchema>;
