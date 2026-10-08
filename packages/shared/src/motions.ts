import { z } from 'zod';

/**
 * How a meeting's background moves: not at all, gentle or full colour drift, twinkling
 * stars, waves, floating circles of light (bokeh) or turning rays of light.
 */
export const MEETING_MOTIONS = [
  'off',
  'calm',
  'lively',
  'stars',
  'waves',
  'bokeh',
  'rays',
  'aurora',
  'silk',
  'mesh',
  'embers',
  'bubbles',
  'snow',
  'lines',
  'grid',
  'grain',
  'fireflies',
  'confetti',
  'warp',
  'goo',
  'ripples',
  'iconfloat',
  'iconrain',
  'iconorbit',
  'leaves',
  'snowfall',
  'petals',
  'flames',
  'glitch',
  'crt',
  'static',
  'matrix',
  'spotlight',
  'disco',
  'hearts',
  'sparkle',
  'smoke',
  'frost',
  'crack',
  'lightleak',
  'film',
  'rgb',
  'oil',
  'gloss',
  'foil',
  'vignette',
  'duotone',
  'photofilter',
  'crossprocess',
  'hdr',
  'halftone',
  'lensflare',
  'grunge',
  'tiltshift',
  'motionblur',
] as const;
export type MeetingMotion = (typeof MEETING_MOTIONS)[number];

/** The animations sorted by type, for the pickers. */
export const MOTION_GROUPS: {
  key:
    | 'light'
    | 'particles'
    | 'liquid'
    | 'texture'
    | 'photo'
    | 'adjust'
    | 'retro'
    | 'stage'
    | 'icons'
    | 'seasons';
  items: MeetingMotion[];
}[] = [
  { key: 'light', items: ['calm', 'lively', 'mesh', 'aurora', 'silk', 'rays'] },
  {
    key: 'particles',
    items: [
      'flames',
      'embers',
      'stars',
      'bokeh',
      'fireflies',
      'bubbles',
      'snow',
      'confetti',
      'warp',
    ],
  },
  { key: 'liquid', items: ['waves', 'goo', 'ripples'] },
  { key: 'texture', items: ['lines', 'grid', 'grain'] },
  {
    key: 'photo',
    items: ['lightleak', 'film', 'rgb', 'oil', 'gloss', 'foil', 'smoke', 'frost', 'crack'],
  },
  {
    key: 'adjust',
    items: [
      'vignette',
      'duotone',
      'photofilter',
      'crossprocess',
      'hdr',
      'halftone',
      'lensflare',
      'grunge',
      'tiltshift',
      'motionblur',
    ],
  },
  { key: 'retro', items: ['glitch', 'crt', 'static', 'matrix'] },
  { key: 'stage', items: ['spotlight', 'disco', 'sparkle', 'hearts'] },
  { key: 'icons', items: ['iconfloat', 'iconrain', 'iconorbit'] },
  { key: 'seasons', items: ['leaves', 'snowfall', 'petals'] },
];

/**
 * Fine-tuning of one animation: speed, size, direction, colour and strength for all, plus
 * what only some animations have (see MOTION_KNOBS): how many / how far apart, how thick
 * or big, and how sharp the edges are.
 */
export const motionTuneSchema = z.object({
  /** 1 = as designed; 0.25 (slow) … 3 (fast). */
  speed: z.number().min(0.25).max(3).nullish(),
  /** 1 = as designed; 0.5 (smaller) … 2 (bigger). */
  size: z.number().min(0.5).max(2).nullish(),
  /** Turns the whole animation (e.g. 90 = rising becomes sideways; lines change slant). */
  angle: z.number().int().min(0).max(359).nullish(),
  /** One colour the animation is drawn in, instead of the ministry's. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  /** How strongly it shows: 0.2 (faint) … 1 (as designed) … 2 (lines and grid only: brighter). */
  strength: z.number().min(0.2).max(2).nullish(),
  /** Particles: how many; lines: the distance between them; grid: the squares' size; flames: how many tongues. */
  density: z.number().min(0.3).max(2.5).nullish(),
  /** Lines and grid: how thick; particles: how big each one is; flames: how high. */
  weight: z.number().min(0.3).max(3).nullish(),
  /** Flames: 0 soft … 1 crisp, sharp tongues; glows (aurora, silk, mesh…): 0 dreamy … 1 clear. */
  sharp: z.number().min(0).max(1).nullish(),
});
export type MotionTune = z.output<typeof motionTuneSchema>;

/** What an animation can be tuned in besides speed, size, direction, colour and strength. */
export type MotionKnob = 'density' | 'weight' | 'sharp';
const PARTICLE_KNOBS: MotionKnob[] = ['density', 'weight'];
const GLOW_KNOBS: MotionKnob[] = ['sharp'];
export const MOTION_KNOBS: Partial<Record<MeetingMotion, MotionKnob[]>> = {
  calm: GLOW_KNOBS,
  lively: GLOW_KNOBS,
  mesh: GLOW_KNOBS,
  aurora: GLOW_KNOBS,
  silk: GLOW_KNOBS,
  bokeh: ['sharp', 'weight'],
  flames: ['sharp', 'weight', 'density'],
  embers: PARTICLE_KNOBS,
  fireflies: PARTICLE_KNOBS,
  bubbles: PARTICLE_KNOBS,
  snow: PARTICLE_KNOBS,
  confetti: PARTICLE_KNOBS,
  warp: ['density'],
  lines: ['density', 'weight'],
  grid: ['density', 'weight'],
  iconfloat: PARTICLE_KNOBS,
  iconrain: PARTICLE_KNOBS,
  iconorbit: ['weight'],
  leaves: PARTICLE_KNOBS,
  snowfall: PARTICLE_KNOBS,
  petals: PARTICLE_KNOBS,
  glitch: ['density', 'weight'],
  crt: ['density'],
  static: ['weight'],
  matrix: PARTICLE_KNOBS,
  spotlight: ['density', 'weight'],
  disco: PARTICLE_KNOBS,
  hearts: PARTICLE_KNOBS,
  sparkle: PARTICLE_KNOBS,
  smoke: ['density', 'sharp'],
  frost: ['weight'],
  crack: ['weight'],
  lightleak: ['density', 'sharp'],
  film: ['weight'],
  rgb: ['weight'],
  oil: ['weight'],
  foil: ['sharp'],
  vignette: ['weight'],
  halftone: ['weight'],
  lensflare: ['weight'],
  grunge: ['weight'],
  tiltshift: ['weight'],
  motionblur: ['weight'],
};

/** Settings per animation (an item's own, over its template's): {kind: MotionTune}. */
export const motionTunesSchema = z.partialRecord(z.enum(MEETING_MOTIONS), motionTuneSchema);
export type MotionTunes = z.output<typeof motionTunesSchema>;

/** Reads stored settings per animation, dropping anything unknown. */
export function readTunes(v: unknown): MotionTunes {
  let raw = v;
  if (typeof v === 'string') {
    try {
      raw = JSON.parse(v);
    } catch {
      return {};
    }
  }
  const r = motionTunesSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}
