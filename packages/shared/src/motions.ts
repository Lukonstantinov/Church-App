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
  // Text in motion: the person's own words in their font, moving as a background (drawn as
  // text on the particle canvas, like the word wall).
  'wordwave',
  'wordtunnel',
  'wordring',
  'wordecho',
  'wordmarquee',
  'wordglitch',
  'wordrain',
  // Lines and shapes in motion (shader engine).
  'wavelines',
  'tunnel',
  'dunes',
  'lightfall',
  'risers',
  'synthgrid',
  'spiral',
  'stripes',
  // Sky, water and light (shader engine).
  'nebula',
  'clouds',
  'caustics',
  'ink',
  'lightning',
  'pulserings',
  'honeycomb',
  'dotwave',
  'grainient',
  'beams',
  'stainedglass',
  'crossglow',
  // Premium moving backgrounds, more particle fields, space and Christmas (shader engine).
  'threadwave',
  'particlewave',
  'liquidmetal',
  'curtains',
  'shards',
  'fluted',
  'dust',
  'swarm',
  'galaxy',
  'starfield',
  'planet',
  'garland',
  'bethlehem',
  'xmassnow',
  'candles',
  // Deep line walls, wire meshes, prisms and glass; oil paint; more glitches (shader engine).
  'depthlines',
  'wiremesh',
  'prism',
  'glassblobs',
  'ringtunnel',
  'oilpaint',
  'vhs',
  'signal',
  'datawave',
  'wavescape',
  'velvet',
  'golddust',
  'goldburst',
  'goldwave',
  'raycurtain',
  'crossbacklit',
  'crossneon',
  'crossglass',
  'crossrays',
  'downpour',
  // A painting filter and glitches that change the photo itself (graphics chip, GpuEffect.tsx).
  'oilfilter',
  'datamosh',
  'pixelsort',
  'scanshift',
  'retro8bit',
  'sketch',
  'neonedge',
  'photomirror',
  'blockglitch',
  'lineglitch',
  'analognoise',
  'wavejitter',
  'scanjitter',
  'tilejitter',
  'rgbsplit',
  'screenjump',
  'badtv',
  // One of the church's own effects (Design → Effect studio), by `tune.ref`: drawn as its
  // layers, so changing it there changes it everywhere it is used.
  'custom',
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
    | 'text'
    | 'sunlight'
    | 'nature'
    | 'sacred'
    | 'cosmic'
    | 'christmas'
    | 'paint'
    | 'gpu';
  items: MeetingMotion[];
}[] = [
  { key: 'light', items: ['calm', 'lively', 'mesh', 'grainient', 'aurora', 'silk', 'rays'] },
  {
    key: 'sacred',
    items: [
      'crossglow',
      'crossbacklit',
      'crossneon',
      'crossglass',
      'crossrays',
      'raycurtain',
      'stainedglass',
      'halo',
      'sunburst',
      'crosses',
      'beams',
      'goldburst',
    ],
  },
  { key: 'nature', items: ['downpour', 'nebula', 'clouds', 'caustics', 'ink', 'lightning'] },
  {
    key: 'cosmic',
    items: ['galaxy', 'starfield', 'planet', 'nebula', 'stardust', 'meteors', 'warp'],
  },
  {
    key: 'christmas',
    items: [
      'bethlehem',
      'garland',
      'xmassnow',
      'candles',
      'snowfall',
      'snow',
      'crossglow',
      'crosses',
    ],
  },
  {
    key: 'abstract',
    items: [
      'datawave',
      'wavescape',
      'velvet',
      'depthlines',
      'wiremesh',
      'prism',
      'glassblobs',
      'ringtunnel',
      'threadwave',
      'particlewave',
      'liquidmetal',
      'fluted',
      'curtains',
      'shards',
      'wavelines',
      'tunnel',
      'risers',
      'lightfall',
      'dunes',
      'stripes',
      'synthgrid',
      'spiral',
      'topo',
      'fur',
      'streaks',
      'ribbons',
      'plasma',
      'kaleido',
      'cells',
      'holo',
      'pulserings',
      'honeycomb',
      'dotwave',
    ],
  },
  {
    key: 'text',
    items: [
      'wordwave',
      'wordecho',
      'wordmarquee',
      'wordring',
      'wordtunnel',
      'wordglitch',
      'wordrain',
      'wordwall',
    ],
  },
  { key: 'sunlight', items: ['sun', 'sunburst', 'halo'] },
  { key: 'paint', items: ['oilpaint', 'oilfilter', 'sketch', 'oil', 'fur', 'marble', 'ink'] },
  {
    key: 'particles',
    items: [
      'golddust',
      'goldburst',
      'goldwave',
      'downpour',
      'dust',
      'swarm',
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
  {
    key: 'retro',
    items: [
      'glitch',
      'vhs',
      'signal',
      'datamosh',
      'pixelsort',
      'scanshift',
      'retro8bit',
      'neonedge',
      'photomirror',
      'blockglitch',
      'lineglitch',
      'analognoise',
      'wavejitter',
      'scanjitter',
      'tilejitter',
      'rgbsplit',
      'screenjump',
      'badtv',
      'crt',
      'static',
      'matrix',
    ],
  },
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
      'oilfilter',
      'datamosh',
      'pixelsort',
      'scanshift',
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
  'oilfilter',
  'datamosh',
  'pixelsort',
  'scanshift',
  'retro8bit',
  'sketch',
  'neonedge',
  'photomirror',
  'blockglitch',
  'lineglitch',
  'analognoise',
  'wavejitter',
  'scanjitter',
  'tilejitter',
  'rgbsplit',
  'screenjump',
  'badtv',
];

/** How a layer of an own effect mixes with what is under it. */
export const MOTION_BLENDS = [
  'normal',
  'screen',
  'overlay',
  'soft-light',
  'multiply',
  'color-dodge',
  'lighten',
  'difference',
  'hue',
  'color',
] as const;
export type MotionBlend = (typeof MOTION_BLENDS)[number];

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
  /** Word wall: every row filled, every row an outline, or by turns. */
  wordStyle: z.enum(['fill', 'outline', 'mix']).nullish(),
  /** Word wall: rows slide by turns both ways, all one way, or stand still. */
  wordFlow: z.enum(['alt', 'same', 'still']).nullish(),
  /**
   * Particles: a soft trail behind each one (0 none … 0.9 long), so fast ones read as a
   * flowing streak instead of jumping dots.
   */
  trail: z.number().min(0).max(0.9).nullish(),
  /** Sky effects (nebula, galaxy, starfield, planet): the colour of space behind them (none = see-through). */
  bg: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  /** Line effects (streaks, falling light, ribbons, rising lines): the set of lines repeated this many times, at different depths. */
  /**
   * Particles: how many times more of them (1 = as set by «how many»; up to 8× — a field of
   * snow or stars far fuller than the density slider alone allows).
   */
  count: z.number().int().min(1).max(8).nullish(),
  lines: z.number().int().min(1).max(8).nullish(),
  /** Line effects: how much the lines bend and wave (0 = straight; negative = the other way). */
  bend: z.number().min(-1).max(1).nullish(),
  /** Own effect (`custom`): which one (an effect template id). */
  ref: z.number().int().positive().nullish(),
  /** A layer of an own effect: how it mixes with the layers under it. */
  blend: z.enum(MOTION_BLENDS).nullish(),
  /** A layer of an own effect: only this part of the block (%, from the top left). */
  box: z
    .object({
      x: z.number().min(-50).max(150),
      y: z.number().min(-50).max(150),
      w: z.number().min(5).max(200),
      h: z.number().min(5).max(200),
    })
    .nullish(),
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
  | 'place'
  | 'wordStyle'
  | 'trail'
  | 'bg'
  | 'lines'
  | 'bend';
const PARTICLE_KNOBS: MotionKnob[] = ['density', 'weight'];
/** Particles drawn on the canvas can also leave trails. */
const CANVAS_KNOBS: MotionKnob[] = ['density', 'weight', 'trail'];
const GLOW_KNOBS: MotionKnob[] = ['sharp'];
/** The shader effects: how many folds/veins/bands, how wild, which variation, own colours. */
const SHADER_KNOBS: MotionKnob[] = ['density', 'chaos', 'sharp', 'seed', 'colors'];
/** Text in motion: the words, their font and look, how many, how big, the glow and colours. */
const TEXT_KNOBS: MotionKnob[] = [
  'words',
  'font',
  'wordStyle',
  'density',
  'weight',
  'glow',
  'colors',
];
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
  streaks: [...SHADER_KNOBS, 'lines', 'bend', 'weight', 'glow'],
  ribbons: [...SHADER_KNOBS, 'lines', 'bend', 'weight', 'glow'],
  plasma: SHADER_KNOBS,
  kaleido: SHADER_KNOBS,
  cells: [...SHADER_KNOBS, 'glow'],
  holo: SHADER_KNOBS,
  sun: ['place', 'weight', 'density', 'glow', 'colors'],
  sunburst: ['place', 'density', 'sharp', 'colors'],
  halo: ['place', 'weight', 'glow', 'colors'],
  wordwall: ['words', 'font', 'wordStyle', 'density', 'weight', 'glow', 'colors'],
  wordwave: [...TEXT_KNOBS, 'chaos'],
  wordtunnel: [...TEXT_KNOBS, 'chaos'],
  wordring: TEXT_KNOBS,
  wordecho: TEXT_KNOBS,
  wordmarquee: TEXT_KNOBS,
  wordglitch: [...TEXT_KNOBS, 'chaos', 'seed'],
  wordrain: [...TEXT_KNOBS, 'seed'],
  wavelines: [...SHADER_KNOBS, 'weight', 'glow'],
  tunnel: [...SHADER_KNOBS, 'weight', 'glow', 'place'],
  dunes: [...SHADER_KNOBS, 'weight'],
  lightfall: [...SHADER_KNOBS, 'lines', 'bend', 'weight', 'glow'],
  risers: [...SHADER_KNOBS, 'lines', 'bend', 'weight', 'glow'],
  synthgrid: ['density', 'weight', 'glow', 'colors'],
  spiral: SHADER_KNOBS,
  stripes: [...SHADER_KNOBS, 'weight'],
  nebula: [...SHADER_KNOBS, 'weight', 'bg'],
  clouds: SHADER_KNOBS,
  caustics: [...SHADER_KNOBS, 'weight'],
  ink: SHADER_KNOBS,
  lightning: ['density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  pulserings: ['place', 'density', 'weight', 'sharp', 'glow', 'colors'],
  honeycomb: [...SHADER_KNOBS, 'weight', 'glow'],
  dotwave: [...SHADER_KNOBS, 'weight'],
  grainient: [...SHADER_KNOBS, 'weight'],
  beams: ['density', 'weight', 'sharp', 'chaos', 'seed', 'colors'],
  stainedglass: ['density', 'weight', 'seed', 'colors'],
  crossglow: ['place', 'weight', 'density', 'sharp', 'glow', 'colors'],
  datawave: ['density', 'weight', 'chaos', 'sharp', 'glow', 'seed', 'colors'],
  wavescape: ['density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  velvet: ['density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  golddust: ['density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  goldburst: ['place', 'density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  goldwave: ['density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  raycurtain: ['place', 'density', 'glow', 'seed', 'colors'],
  crossbacklit: ['place', 'weight', 'density', 'glow', 'seed', 'colors'],
  crossneon: ['place', 'weight', 'sharp', 'glow', 'seed', 'colors'],
  crossglass: ['place', 'weight', 'sharp', 'glow', 'colors'],
  crossrays: ['place', 'weight', 'density', 'glow', 'seed', 'colors'],
  downpour: ['density', 'weight', 'chaos', 'seed', 'colors'],
  threadwave: [...SHADER_KNOBS, 'weight', 'glow'],
  particlewave: [...SHADER_KNOBS, 'weight', 'glow'],
  liquidmetal: [...SHADER_KNOBS, 'weight'],
  curtains: SHADER_KNOBS,
  shards: ['density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  fluted: ['density', 'weight', 'chaos', 'sharp', 'seed', 'colors'],
  dust: ['density', 'weight', 'chaos', 'seed', 'colors'],
  swarm: ['density', 'weight', 'chaos', 'glow', 'seed', 'colors'],
  galaxy: ['place', 'density', 'chaos', 'sharp', 'seed', 'colors', 'bg'],
  starfield: ['density', 'weight', 'seed', 'colors', 'bg'],
  planet: ['place', 'weight', 'density', 'chaos', 'sharp', 'glow', 'seed', 'colors', 'bg'],
  garland: ['density', 'weight', 'glow', 'seed', 'colors'],
  bethlehem: ['place', 'weight', 'density', 'sharp', 'glow', 'colors'],
  xmassnow: ['density', 'weight', 'chaos', 'seed', 'colors'],
  candles: ['density', 'weight', 'seed', 'colors'],
  depthlines: [...SHADER_KNOBS, 'lines', 'bend', 'weight', 'glow'],
  wiremesh: [...SHADER_KNOBS, 'weight', 'glow'],
  prism: [...SHADER_KNOBS, 'weight'],
  glassblobs: [...SHADER_KNOBS, 'weight'],
  ringtunnel: ['place', 'density', 'weight', 'chaos', 'sharp', 'glow', 'seed', 'colors'],
  oilpaint: [...SHADER_KNOBS, 'weight'],
  vhs: ['density', 'weight', 'chaos', 'seed', 'colors'],
  signal: ['density', 'weight', 'chaos', 'seed', 'colors'],
  oilfilter: ['weight', 'density'],
  datamosh: ['weight', 'density'],
  pixelsort: ['weight', 'density'],
  scanshift: ['weight', 'density'],
  retro8bit: ['weight', 'density'],
  sketch: ['weight', 'density'],
  neonedge: ['weight', 'density'],
  photomirror: ['weight', 'density'],
  blockglitch: ['weight', 'density'],
  lineglitch: ['weight', 'density'],
  analognoise: ['weight', 'density'],
  wavejitter: ['weight', 'density'],
  scanjitter: ['weight', 'density'],
  tilejitter: ['weight', 'density'],
  rgbsplit: ['weight', 'density'],
  screenjump: ['weight', 'density'],
  badtv: ['weight', 'density'],
  custom: [],
  embers: CANVAS_KNOBS,
  fireflies: CANVAS_KNOBS,
  bubbles: CANVAS_KNOBS,
  snow: CANVAS_KNOBS,
  confetti: CANVAS_KNOBS,
  warp: ['density'],
  lines: ['density', 'weight'],
  grid: ['density', 'weight'],
  iconfloat: CANVAS_KNOBS,
  iconrain: CANVAS_KNOBS,
  iconorbit: ['weight'],
  leaves: CANVAS_KNOBS,
  snowfall: CANVAS_KNOBS,
  petals: CANVAS_KNOBS,
  glitch: ['density', 'weight'],
  crt: ['density'],
  static: ['weight'],
  matrix: [...PARTICLE_KNOBS, 'symbols', 'words'],
  spotlight: ['density', 'weight'],
  disco: PARTICLE_KNOBS,
  hearts: CANVAS_KNOBS,
  sparkle: CANVAS_KNOBS,
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
  rain: CANVAS_KNOBS,
  stardust: CANVAS_KNOBS,
  orbs: CANVAS_KNOBS,
  meteors: CANVAS_KNOBS,
  glitter: CANVAS_KNOBS,
  fireworks: CANVAS_KNOBS,
  notes: CANVAS_KNOBS,
  crosses: CANVAS_KNOBS,
};

/**
 * Animations made of particles: they get «more particles» (`count`) in their settings.
 * Shader effects added later that are particle fields belong here too.
 */
export const PARTICLE_LIKE: ReadonlySet<MeetingMotion> = new Set<MeetingMotion>([
  'golddust',
  'goldburst',
  'goldwave',
  'downpour',
  'stars',
  'bokeh',
  'embers',
  'bubbles',
  'snow',
  'fireflies',
  'confetti',
  'warp',
  'iconfloat',
  'iconrain',
  'leaves',
  'snowfall',
  'petals',
  'hearts',
  'sparkle',
  'disco',
  'rain',
  'stardust',
  'orbs',
  'meteors',
  'glitter',
  'fireworks',
  'notes',
  'crosses',
  'dust',
  'swarm',
  'starfield',
  'xmassnow',
  'candles',
  'particlewave',
  'garland',
]);

/** Text in motion: drawn from the person's words (the ministry's name when none are given). */
export const TEXT_MOTIONS: ReadonlySet<MeetingMotion> = new Set<MeetingMotion>([
  'wordwall',
  'wordwave',
  'wordtunnel',
  'wordring',
  'wordecho',
  'wordmarquee',
  'wordglitch',
  'wordrain',
]);

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
