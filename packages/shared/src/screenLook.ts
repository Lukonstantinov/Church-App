import { z } from 'zod';
import { MEETING_MOTIONS } from './api';
import { ENTER_ANIMATIONS } from './brand';
import { appBackgroundSchema } from './background';

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

/** Fine-tuning of a part's animations: speed, size, direction and colour. */
export const motionTuneSchema = z.object({
  /** 1 = as designed; 0.25 (slow) … 3 (fast). */
  speed: z.number().min(0.25).max(3).nullish(),
  /** 1 = as designed; 0.5 (smaller) … 2 (bigger). */
  size: z.number().min(0.5).max(2).nullish(),
  /** Turns the whole animation (e.g. 90 = rising becomes sideways). */
  angle: z.number().int().min(0).max(359).nullish(),
  /** One colour the animation is drawn in, instead of the ministry's. */
  color: hex.nullish(),
});
export type MotionTune = z.output<typeof motionTuneSchema>;

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
  tune: motionTuneSchema.nullish(),
  icon: motionIconSchema.nullish(),
  /** Meetings: the tile has its own animation instead of the meeting screen's. */
  own: z.boolean().nullish(),
});
export type ModuleLook = z.output<typeof moduleLookSchema>;

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
});
export type ChurchStudioInput = z.input<typeof churchStudioSchema>;
