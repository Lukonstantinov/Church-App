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
