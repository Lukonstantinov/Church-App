import { z } from 'zod';

/**
 * How a meeting's background moves: not at all, gentle or full colour drift, twinkling
 * stars, waves, floating circles of light (bokeh) or turning rays of light.
 */
/** How many effects one cover, post or poster layer can wear at once (more gets heavy on phones). */
export const MAX_EFFECTS = 8;

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
  // Drawn by the graphics chip (PixiJS filters, components/GpuEffect.tsx).
  'heatwave',
  'shockwave',
  'bloom',
  'zoomburst',
  'swirl',
  'bulge',
  'godrays',
  'reflection',
  // Particles made for a colour of one's own (the colour knob paints them).
  'rain',
  'stardust',
  'orbs',
  'meteors',
  'glitter',
  'fireworks',
  'notes',
  'crosses',
  // Drawn by the shared shader engine (components/ShaderEffect.tsx): smooth, low-res, light.
  'liquid',
  'marble',
  // More of the shader engine: abstract moving backgrounds and light.
  'topo',
  'fur',
  'streaks',
  'ribbons',
  'plasma',
  'kaleido',
  'cells',
  'holo',
  'sun',
  'sunburst',
  'halo',
  // Words of one's own, repeated in rows that slide (drawn as text, any font).
  'wordwall',
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
    | 'seasons'
    | 'colour'
    | 'abstract'
    | 'sunlight'
    | 'gpu';
  items: MeetingMotion[];
}[] = [
  { key: 'light', items: ['calm', 'lively', 'mesh', 'aurora', 'silk', 'rays'] },
  {
    key: 'abstract',
    items: ['topo', 'fur', 'streaks', 'ribbons', 'plasma', 'kaleido', 'cells', 'holo', 'wordwall'],
  },
  { key: 'sunlight', items: ['sun', 'sunburst', 'halo'] },
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
  { key: 'liquid', items: ['liquid', 'marble', 'waves', 'goo', 'ripples'] },
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
  {
    key: 'colour',
    items: ['rain', 'stardust', 'orbs', 'meteors', 'glitter', 'fireworks', 'notes', 'crosses'],
  },
  {
    key: 'gpu',
    items: [
      'heatwave',
      'shockwave',
      'bloom',
      'zoomburst',
      'swirl',
      'bulge',
      'godrays',
      'reflection',
    ],
  },
];

/** The animations the graphics chip draws (a photo bent, lit or blurred; one canvas each). */
export const GPU_MOTIONS: readonly MeetingMotion[] = [
  'heatwave',
  'shockwave',
  'bloom',
  'zoomburst',
  'swirl',
  'bulge',
  'godrays',
  'reflection',
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
  /** Shader effects (silk, liquid, marble, colour flow): 0 calm and even … 1 wild, turbulent. */
  chaos: z.number().min(0).max(1).nullish(),
  /** Shader effects: which of endless variations of the pattern (🎲 picks another). */
  seed: z.number().int().min(0).max(9999).nullish(),
  /** Shader effects: up to 4 colours of one's own, instead of the ministry's. */
  colors: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .max(4)
    .nullish(),
  /** Digital rain: the letters and symbols that fall (empty = the classic ones). */
  symbols: z.string().max(60).nullish(),
  /**
   * Digital rain: whole words falling one after another (up to 10), instead of symbols;
   * the word wall: the words repeated in its rows.
   */
  words: z.array(z.string().trim().min(1).max(30)).max(10).nullish(),
  /** The word wall: its font (a FONTS key; unknown = the app's own). */
  font: z.string().max(40).nullish(),
  /** Lines and light (topography, line wall, ribbons, word wall…): 0 plain … 1 bright neon glow. */
  glow: z.number().min(0).max(1).nullish(),
  /** Sun, sunburst, halo: where its centre is (share of the width / height, 0…1). */
  x: z.number().min(0).max(1).nullish(),
  y: z.number().min(0).max(1).nullish(),
  /** Sun and halo: drift slowly around where it is placed (true) or stay put. */
  drift: z.boolean().nullish(),
});
export type MotionTune = z.output<typeof motionTuneSchema>;

/** What an animation can be tuned in besides speed, size, direction, colour and strength. */
export type MotionKnob =
  | 'density'
  | 'weight'
  | 'sharp'
  | 'chaos'
  | 'seed'
  | 'colors'
  | 'symbols'
  | 'words'
  | 'font'
  | 'glow'
  | 'place';
const PARTICLE_KNOBS: MotionKnob[] = ['density', 'weight'];
const GLOW_KNOBS: MotionKnob[] = ['sharp'];
/** The shader effects: how many folds/veins/bands, how wild, which variation, own colours. */
const SHADER_KNOBS: MotionKnob[] = ['density', 'chaos', 'sharp', 'seed', 'colors'];
export const MOTION_KNOBS: Partial<Record<MeetingMotion, MotionKnob[]>> = {
  calm: GLOW_KNOBS,
  lively: GLOW_KNOBS,
  mesh: SHADER_KNOBS,
  aurora: GLOW_KNOBS,
  silk: [...SHADER_KNOBS, 'weight'],
  liquid: [...SHADER_KNOBS, 'weight'],
  marble: [...SHADER_KNOBS, 'weight'],
  bokeh: ['sharp', 'weight'],
  flames: [...SHADER_KNOBS, 'weight'],
  topo: [...SHADER_KNOBS, 'weight', 'glow'],
  fur: [...SHADER_KNOBS, 'weight', 'place'],
  streaks: [...SHADER_KNOBS, 'weight', 'glow'],
  ribbons: [...SHADER_KNOBS, 'weight', 'glow'],
  plasma: SHADER_KNOBS,
  kaleido: SHADER_KNOBS,
  cells: [...SHADER_KNOBS, 'glow'],
  holo: SHADER_KNOBS,
  sun: ['place', 'weight', 'density', 'glow', 'colors'],
  sunburst: ['place', 'density', 'sharp', 'colors'],
  halo: ['place', 'weight', 'glow', 'colors'],
  wordwall: ['words', 'font', 'density', 'weight', 'glow', 'colors'],
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
  matrix: [...PARTICLE_KNOBS, 'symbols', 'words'],
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
  heatwave: ['weight'],
  shockwave: ['weight'],
  bloom: ['weight'],
  zoomburst: ['weight'],
  swirl: ['weight'],
  bulge: ['weight'],
  godrays: ['density'],
  reflection: ['weight'],
  rain: PARTICLE_KNOBS,
  stardust: PARTICLE_KNOBS,
  orbs: PARTICLE_KNOBS,
  meteors: PARTICLE_KNOBS,
  glitter: PARTICLE_KNOBS,
  fireworks: PARTICLE_KNOBS,
  notes: PARTICLE_KNOBS,
  crosses: PARTICLE_KNOBS,
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
