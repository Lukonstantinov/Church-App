import { useEffect, useRef, type CSSProperties } from 'react';
import { SCALE_MIN, stepScale } from '../lib/adapt';
import type { MotionTune } from '@church/shared';
import { getMotion } from '../lib/motion';
import { getQuality, useEffectQuality, useUnlimited, watchOffscreen } from '../lib/perf';

/**
 * The shader engine: smooth effects — silk, colour flow, liquid gradient, marble and the
 * moving gradient fills of poster layers — drawn by the graphics chip, small, into a plain
 * picture (a 2D canvas) per block.
 *
 * Why it exists (measured in Chromium at an iPhone's 3× pixels): the CSS versions were
 * blurred layers two to four times the size of their box, so the phone kept a huge picture
 * of each one — one poster with a flowing fill, silk and colour flow held about 260 MB of
 * graphics memory, which is what made iPhones close the app. These effects are soft by
 * nature, so they are drawn at a fraction of the screen's pixels (RES) and stretched: they
 * look the same and cost a few hundred KB each.
 *
 * - ONE WebGL context for the whole app (phones allow only a few, and each is heavy): it
 *   draws a block's picture, which is then copied onto that block's own 2D canvas.
 * - One clock for all of them (24 a second, 20 on lite), skipping blocks off screen or over
 *   the running limit (data-off from watchOffscreen) and copies kept still (.motion-still).
 * - A recording steps them through time instead (seekShaders / holdShaders).
 * - Without WebGL nothing is drawn: the still paint under the effect stays.
 */

export type ShaderKind =
  | 'silk'
  | 'mesh'
  | 'liquid'
  | 'marble'
  | 'fill'
  | 'flames'
  | 'topo'
  | 'fur'
  | 'streaks'
  | 'ribbons'
  | 'plasma'
  | 'kaleido'
  | 'cells'
  | 'holo'
  | 'sun'
  | 'sunburst'
  | 'halo'
  | 'aurora'
  | 'goo'
  | 'wavelines'
  | 'tunnel'
  | 'dunes'
  | 'lightfall'
  | 'risers'
  | 'synthgrid'
  | 'spiral'
  | 'stripes'
  | 'nebula'
  | 'clouds'
  | 'caustics'
  | 'ink'
  | 'lightning'
  | 'pulserings'
  | 'honeycomb'
  | 'dotwave'
  | 'grainient'
  | 'beams'
  | 'stainedglass'
  | 'crossglow'
  | 'threadwave'
  | 'particlewave'
  | 'liquidmetal'
  | 'curtains'
  | 'shards'
  | 'fluted'
  | 'dust'
  | 'swarm'
  | 'galaxy'
  | 'starfield'
  | 'planet'
  | 'garland'
  | 'bethlehem'
  | 'xmassnow'
  | 'candles';

/** The animations drawn by this engine. */
export const SHADER_KINDS: ReadonlySet<string> = new Set<ShaderKind>([
  'silk',
  'mesh',
  'liquid',
  'marble',
  'flames',
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
  'aurora',
  'goo',
  'wavelines',
  'tunnel',
  'dunes',
  'lightfall',
  'risers',
  'synthgrid',
  'spiral',
  'stripes',
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
]);

/** How much of the screen's pixels each kind is drawn at (soft ones less, thin lines more). */
const RES: Record<ShaderKind, number> = {
  liquid: 0.4,
  mesh: 0.25,
  silk: 0.5,
  marble: 1,
  fill: 0.25,
  flames: 0.4,
  topo: 0.75,
  fur: 0.75,
  streaks: 0.6,
  ribbons: 0.6,
  plasma: 0.3,
  kaleido: 0.45,
  cells: 0.6,
  holo: 0.3,
  sun: 0.4,
  sunburst: 0.5,
  halo: 0.25,
  aurora: 0.3,
  goo: 0.5,
  wavelines: 1,
  tunnel: 1,
  dunes: 0.6,
  lightfall: 0.6,
  risers: 0.75,
  synthgrid: 0.75,
  spiral: 0.35,
  stripes: 0.35,
  nebula: 0.5,
  clouds: 0.35,
  caustics: 0.5,
  ink: 0.5,
  lightning: 0.75,
  pulserings: 0.75,
  honeycomb: 0.75,
  dotwave: 1,
  grainient: 0.9,
  beams: 0.4,
  stainedglass: 0.75,
  crossglow: 0.6,
  threadwave: 1,
  particlewave: 1,
  liquidmetal: 0.6,
  curtains: 0.4,
  shards: 0.75,
  fluted: 1,
  dust: 0.6,
  swarm: 0.75,
  galaxy: 0.6,
  starfield: 0.75,
  planet: 0.75,
  garland: 0.75,
  bethlehem: 0.75,
  xmassnow: 0.6,
  candles: 0.4,
};
/**
 * How sharp each kind is drawn, as a share of the screen's own pixels (the screen's
 * density counted up to 2): kinds with thin lines and hard edges (RES of 0.6 and up) at
 * full sharpness, the middle ones at ¾, soft glows and clouds at a little over half — and
 * never below one picture pixel per page pixel (soft ones: ¾), or a computer screen showed
 * them as blocks. Measured before (2026-11): every kind was drawn at 13–56 % of the screen's
 * pixels and stretched, which read as pixelated.
 */
function density(res: number) {
  return res >= 0.6 ? 1 : res >= 0.4 ? 0.75 : 0.55;
}
/**
 * The most pixels one block's picture may have (its area): a big block is drawn a little
 * softer instead of costing the phone more. Thin-line kinds get more. A recording draws at
 * the size it records (up to about 2048 × 2048).
 */
const BUDGET_CRISP = 900_000;
const BUDGET_SOFT = 600_000;
const BUDGET_RECORDING = 4_200_000;
/** The shared canvas's starting size when pictures are copied (it grows when needed). */
const MAX_SIDE = 512;

/** What a shader is told besides the time: all already in the 0…1-ish ranges it expects. */
export interface ShaderParams {
  kind: ShaderKind;
  /** Up to 4 colours (#rrggbb); empty = the block's own (ministry) colours. */
  colors: string[];
  speed: number;
  size: number;
  /** Turn, in degrees (CSS: 0 = upwards, clockwise). */
  angle: number;
  strength: number;
  density: number;
  weight: number;
  sharp: number;
  chaos: number;
  seed: number;
  /** Fills: 0 flowing, 1 turning, 2 breathing; paint 0 linear, 1 radial. */
  mode: number;
  paint: number;
  /** Neon glow round lines and light (0 … 1). */
  glow: number;
  /** Where a sun / halo / swirl centre is (0…1 of width and height, from the top left). */
  x: number;
  y: number;
  drift: boolean;
  /** The colour of space behind a sky effect (#rrggbb), or none: see-through as before. */
  bg: string | null;
  /** Line effects: how many times the set of lines is repeated, at different depths (1…8). */
  lines: number;
  /** Line effects: how much the lines bend and wave (−1 … 1; 0 = straight). */
  bend: number;
}

/** Where a placed effect's centre is until it is moved (share of the width / height). */
export function placeDefault(kind: string): { x: number; y: number } {
  if (kind === 'fur') return { x: 0.8, y: 0.15 };
  if (kind === 'sun' || kind === 'halo') return { x: 0.72, y: 0.28 };
  if (kind === 'crossglow') return { x: 0.5, y: 0.42 };
  if (kind === 'bethlehem') return { x: 0.5, y: 0.3 };
  if (kind === 'planet') return { x: 0.6, y: 0.42 };
  return { x: 0.5, y: 0.5 };
}

/** How sharp a kind is until it is tuned (marble's veins; the planet's ring: 0 = none; crisp ribs). */
export function sharpDefault(kind: string): number {
  if (kind === 'marble') return 0.45;
  if (kind === 'planet') return 0.7;
  if (kind === 'fluted') return 0.6;
  return 0;
}

/** How many depths of lines a line effect has until it is tuned. */
export function linesDefault(kind: string): number {
  return kind === 'streaks' || kind === 'lightfall' ? 3 : 2;
}
/** How much a line effect's lines wave until it is tuned (a little: they should flow, not stand stiff). */
export function bendDefault(kind: string): number {
  if (kind === 'ribbons') return 0.4;
  if (kind === 'streaks' || kind === 'risers') return 0.25;
  if (kind === 'lightfall') return 0.15;
  return 0;
}

/** A tune turned into shader settings (with the defaults each kind is designed at). */
export function shaderParams(kind: ShaderKind, tune?: MotionTune | null): ShaderParams {
  return {
    kind,
    colors: tune?.colors?.length ? tune.colors : tune?.color ? [tune.color] : [],
    speed: tune?.speed ?? 1,
    size: tune?.size ?? 1,
    angle: tune?.angle ?? 0,
    strength: tune?.strength ?? 1,
    // «More particles» (particle fields only) multiplies the density; loops stay bounded.
    density: (tune?.density ?? 1) * (tune?.count ?? 1),
    weight: tune?.weight ?? 1,
    sharp: tune?.sharp ?? sharpDefault(kind),
    chaos: tune?.chaos ?? (kind === 'liquid' ? 0.45 : kind === 'marble' ? 0.35 : 0.3),
    seed: tune?.seed ?? 0,
    mode: 0,
    paint: 0,
    glow: tune?.glow ?? 0,
    x: tune?.x ?? placeDefault(kind).x,
    y: tune?.y ?? placeDefault(kind).y,
    drift: tune?.drift ?? false,
    bg: tune?.bg ?? null,
    lines: tune?.lines ?? linesDefault(kind),
    bend: tune?.bend ?? bendDefault(kind),
  };
}

// ---------- The shaders ----------

const VERTEX = `
attribute vec2 a;
varying vec2 v_uv;
void main() { v_uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

/** Shared by every kind: noise, fractal noise and a palette of up to four colours. */
const COMMON = `
precision highp float;
#ifdef GL_OES_standard_derivatives
/** How much x changes from one picture pixel to the next: edges a pixel or two soft, never stairs. */
#define AA(x) fwidth(x)
#define AA2(v) fwidth(v)
#else
#define AA(x) (1.5 / u_res.y)
#define AA2(v) vec2(1.5 / u_res.y)
#endif
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_t;
uniform vec3 u_c[4];
uniform float u_n;
uniform float u_strength, u_density, u_weight, u_sharp, u_chaos, u_seed, u_angle, u_size;
uniform float u_mode, u_paint;
uniform float u_glow;
uniform vec2 u_pos;
uniform vec4 u_bg;
uniform float u_lines, u_bend;

/** The placed centre (sun, halo, swirl) in the same space as place(), unturned. */
vec2 centre(vec2 at) {
  return (at - 0.5) * vec2(u_res.x / u_res.y, 1.0);
}

vec3 hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
/** Fewer octaves: big smooth shapes (liquids, folds) without fine grit. */
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return v / 0.875;
}
/** Colour at x along the palette; cyclic: the last colour runs back into the first. */
vec3 palette(float x, bool cyclic) {
  float n = max(u_n, 1.0);
  float span = cyclic ? n : n - 1.0;
  if (span < 0.5) return u_c[0];
  x = cyclic ? fract(x) : clamp(x, 0.0, 1.0);
  float f = x * span;
  float i = floor(f);
  float k = f - i;
  vec3 a = u_c[0], b = u_c[0];
  for (int j = 0; j < 4; j++) {
    float fj = float(j);
    if (fj == i) a = u_c[j];
    if (fj == mod(i + 1.0, n)) b = u_c[j];
  }
  return mix(a, b, k);
}
/** The point in the box, centred, aspect kept, turned by the effect's angle. */
vec2 place() {
  vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float c = cos(u_angle), s = sin(u_angle);
  return mat2(c, -s, s, c) * p;
}
vec2 seedShift() { return hash3(vec3(u_seed, u_seed * 0.37, 1.0)).xy * 100.0; }
float hash1(float n) { return fract(sin(n * 91.345 + u_seed * 7.13) * 47453.5453); }
/** The point in the box without the turn (for things placed by x / y). */
vec2 plane() { return (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0); }
/** The picture laid over the chosen colour of space (solid), or left see-through when none is chosen. */
vec4 overSpace(vec4 c) {
  return u_bg.a > 0.5 ? vec4(c.rgb + u_bg.rgb * (1.0 - c.a), 1.0) : c;
}
/** A step from 0 to 1 at edge e, smoothed over about a pixel and a half (no stairs). */
float aaStep(float e, float x) {
  float a = AA(x) * 0.9 + 1e-5;
  return smoothstep(e - a, e + a, x);
}
/** A soft line of half-width w round distance d, plus its neon halo. */
vec2 lineGlow(float d, float w) {
  float soft = max(mix(0.6, 0.12, u_sharp) * w + 0.002, AA(d) * 1.5);
  float core = 1.0 - smoothstep(w, w + soft, d);
  float halo = exp(-d / (w * 6.0 + 0.01)) * u_glow;
  return vec2(core, halo);
}
`;

/**
 * Shared by the fields of specks (dust, snow, stars, candle lights): one layer is a grid
 * with one soft disc somewhere in each cell — no loop over particles, so a thousand cost
 * the same as ten. A disc never reaches its cell's edge, where it would be cut off.
 */
const MOTES = `
/** x = how bright the disc is here, y = a random number of its own, z = distance from its middle (1 = its edge). */
vec3 mote(vec2 q, float r, float soft, float keep, float salt, float wob) {
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  vec3 h = hash3(vec3(id + 17.0, salt * 7.31 + u_seed + 1.0));
  float sa = max(soft, AA(q.x) * 1.2);
  float reach = max(0.5 - r - sa - wob, 0.0);
  vec2 o = (h.xy - 0.5) * 2.0 * reach
    + wob * vec2(sin(u_t * 0.6 + h.z * 40.0), cos(u_t * 0.45 + h.x * 31.0));
  float d = length(f - o);
  float k = (1.0 - smoothstep(max(r - sa, 0.0), r + sa, d)) * step(h.z, keep);
  return vec3(k, fract(h.z * 57.3 + h.x * 13.7), d / max(r, 1e-4));
}
`;

/**
 * Shared by the light streaks and falling light: one depth of soft strands. Several depths
 * are laid over each other (the "multiply lines" knob) — the near ones wide, soft and
 * faint, the middle ones crisp and bright, the far ones thin and dim — so the picture has
 * depth instead of one flat row of bars.
 */
const STRANDS = `
/** q.x runs along the strands, q.y across them. Its light (colour, cover). */
vec4 strands(vec2 q, float fi, float rows, float bothWays) {
  float z = u_lines > 1.5 ? fi / (u_lines - 1.0) : 0.5;
  float focus = 1.0 - abs(z - 0.5) * 2.0;
  // Bend: every depth waves in its own slow rhythm; chaos adds an uneven wander.
  float wav = u_bend * (0.16 * sin(q.x * 1.7 + u_t * 0.13 + fi * 1.9) + 0.06 * sin(q.x * 3.9 - u_t * 0.09 + fi * 4.1))
    + u_chaos * 0.12 * (noise(vec2(q.x * 1.4 + fi * 5.0, q.y * 1.1 + u_t * 0.04)) - 0.5);
  float g = (q.y + wav) * rows * mix(0.6, 1.5, z) + fi * 3.71;
  float row = floor(g) + fi * 101.0;
  float d = abs(fract(g) - 0.5);
  float h = hash1(row);
  float speed = (0.25 + h * 0.9 + u_chaos * hash1(row + 3.1) * 1.2) * mix(1.3, 0.6, z);
  float dir = bothWays > 0.5 && hash1(row + 9.7) < 0.5 - u_chaos * 0.5 ? -1.0 : 1.0;
  float len = 0.7 + hash1(row + 1.7) * 1.8;
  float s = q.x / len + u_t * speed * 0.3 * dir + hash1(row + 4.4) * 10.0;
  float duty = 0.3 + hash1(row + 7.3) * 0.5;
  float f = fract(s);
  // 0 at the head, 1 at the end of the tail: the head is feathered, the tail dies away,
  // so a strand has no cut-off ends.
  float u = dir > 0.0 ? f / duty : 1.0 - f / duty;
  float b = f < duty ? smoothstep(0.0, 0.14, u) * pow(1.0 - u, 1.5) * 1.4 : 0.0;
  b *= 0.8 + 0.2 * sin(q.x * 7.0 + h * 30.0);
  float px = AA(g) + 1e-4;
  // Thinner toward its ends (a tapered stroke), never thinner than the pixels can show.
  float w = clamp((0.045 + 0.085 * u_weight) * mix(1.9, 0.55, z) * (0.3 + 0.7 * b), px * 0.6, 0.3);
  float soft = max(w * mix(0.9, 0.25, u_sharp) * mix(1.8, 1.0, smoothstep(0.0, 0.5, z)), px * 1.3);
  float core = 1.0 - smoothstep(max(w - soft, 0.0) * 0.5, w + soft, d);
  float halo = exp(-d / (w * 5.0 + 0.01)) * u_glow * 0.8;
  // Nothing of a strand reaches its neighbour's lane (it would be cut off there).
  // More depths: each a little fainter, so the whole stays as bright as it was.
  float k = (core + halo) * (1.0 - smoothstep(0.3, 0.5, d)) * b * mix(0.4, 1.0, focus)
    * min(1.3, 2.1 * inversesqrt(u_lines));
  return vec4(palette(hash1(row + 2.2), true) * k * (1.0 + halo * 0.5), k);
}
`;

const FRAGMENTS: Record<ShaderKind, string> = {
  // Liquid gradient: colours poured into each other and slowly stirred (a domain-warped
  // field — the field is bent by itself, more so with more chaos), with a soft gloss.
  liquid: `
void main() {
  vec2 p = place() * (1.1 / u_size) + seedShift();
  float t = u_t * 0.09;
  float warp = 0.9 + u_chaos * 3.2;
  vec2 q = vec2(fbm3(p + vec2(0.0, t)), fbm3(p + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm3(p + warp * q + vec2(1.7, 9.2) + t * 0.6),
                fbm3(p + warp * q + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm3(p + warp * r);
  float x = (f * 1.3 + q.x * 0.5) * (0.5 + u_density * 0.5) + t * 0.25;
  // Clear: the colours meet in sharper waves instead of melting.
  float b = fract(x);
  float edge = mix(0.5, 0.03, u_sharp);
  float stepped = floor(x) + smoothstep(0.5 - edge, 0.5 + edge, b);
  vec3 col = palette(mix(x, stepped, u_sharp * 0.9), true);
  // Gloss: light caught on the rims of the pours, and a little shade in their folds.
  float rim = sin(f * 10.0 + length(r) * 4.0);
  col += pow(max(0.0, rim), 12.0) * 0.22 * u_weight;
  col *= 0.9 + 0.1 * smoothstep(-1.0, 1.0, rim);
  float a = u_strength;
  gl_FragColor = vec4(col * a, a);
}`,
  // Marble: cloudy stone with veins running through it, flowing very slowly.
  marble: `
void main() {
  vec2 p = place() * (2.2 / u_size) + seedShift();
  float t = u_t * 0.03;
  float turb = 1.0 + u_chaos * 5.0;
  float n = fbm(p * 0.9 + vec2(t, -t * 0.6));
  float w = fbm(p * 1.8 + n * turb + vec2(-t, t * 0.4));
  float v = abs(sin((p.x * 0.9 + p.y * 0.35) * (2.0 + u_density * 3.0) + w * (4.0 + u_chaos * 8.0)));
  float width = 0.012 + 0.05 * u_weight;
  float soft = mix(0.35, 0.02, u_sharp);
  float vein = 1.0 - smoothstep(width, width + soft, v);
  // Thin second veins in the accent colour.
  float v2 = abs(sin((p.y * 1.3 - p.x * 0.5) * (3.0 + u_density * 4.0) + w * 9.0 + n * 3.0));
  float vein2 = (1.0 - smoothstep(width * 0.35, width * 0.35 + soft * 0.6, v2)) * smoothstep(0.45, 0.7, n);
  vec3 base = mix(u_c[0], u_c[1], smoothstep(0.25, 0.8, w));
  vec3 col = mix(base, u_c[2], vein * 0.9);
  col = mix(col, u_c[3], vein2 * 0.85);
  // A faint polish moving over the stone.
  col += 0.06 * pow(max(0.0, sin((p.x + p.y) * 1.4 + t * 6.0)), 12.0);
  float a = u_strength;
  gl_FragColor = vec4(col * a, a);
}`,
  // Silk: satin folds swaying; more chaos = folds that twist unpredictably. Without own
  // colours it is a sheen of light over the block (as before); with them, a whole cloth.
  silk: `
void main() {
  vec2 p = place() * (1.4 / u_size);
  float t = u_t * 0.16;
  vec2 s = seedShift();
  float c = cos(0.35), sn = sin(0.35);
  p = mat2(c, -sn, sn, c) * p;
  vec2 w = vec2(fbm3(p * 0.9 + s + vec2(t, 0.0)), fbm3(p * 0.9 + s + vec2(3.1, -t))) - 0.5;
  w *= 0.8 + u_chaos * 4.0;
  float freq = 2.5 + u_density * 3.5;
  float fold = sin(p.x * freq + w.x * 4.0 + sin(p.y * 1.7 + t) * (0.6 + u_chaos));
  fold = fold * 0.5 + 0.5;
  float sheen = pow(fold, mix(2.0, 14.0, u_sharp));
  float shade = smoothstep(0.0, 1.0, fold);
  if (u_paint > 0.5) {
    vec3 col = palette(shade * 0.85 + w.y * 0.25 + 0.1, false);
    col = col * (0.55 + 0.55 * shade) + sheen * 0.4 * u_weight;
    gl_FragColor = vec4(col * u_strength, u_strength);
  } else {
    vec3 col = mix(vec3(1.0), u_c[0], 0.35);
    float a = clamp(sheen * 0.42 * u_weight + shade * 0.08, 0.0, 1.0) * u_strength;
    gl_FragColor = vec4(col * a, a);
  }
}`,
  // Colour flow: a slowly turning wheel of the colours, soft (as the old blurred CSS one).
  mesh: `
vec3 wheel(vec2 p, float t) {
  float wob = (fbm3(p * 1.5 + seedShift() + t) - 0.5) * (0.2 + u_chaos * 1.2);
  float a = atan(p.y, p.x) / 6.2831853 + t + wob;
  float x = a * (0.5 + u_density * 0.5);
  float edge = mix(0.5, 0.05, u_sharp);
  float stepped = floor(x * 3.0) / 3.0 + smoothstep(0.5 - edge, 0.5 + edge, fract(x * 3.0)) / 3.0;
  return palette(mix(x, stepped, u_sharp * 0.7), true);
}
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.07;
  // Two wheels a little apart, averaged: no hard point where the colours meet in the middle.
  vec2 o = vec2(cos(t * 3.0), sin(t * 2.0)) * 0.12;
  vec3 col = 0.5 * (wheel(p + o, t) + wheel(p - o, t + 0.13));
  float al = 0.55 * u_strength;
  gl_FragColor = vec4(col * al, al);
}`,
  // Fiery glow (it replaces the old flames): burning clouds lit from inside — a domain-warped
  // field with bright ridged filaments. Dark parts stay see-through.
  flames: `
void main() {
  vec2 p = place() * (1.5 / u_size) + seedShift();
  float t = u_t * 0.12;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  float f = fbm(p * 1.4 + (1.4 + u_chaos * 3.0) * q + vec2(t * 0.4, -t * 0.7));
  float ridge = 1.0 - abs(2.0 * fbm(p * 2.6 + q * 2.0 - vec2(0.0, t * 1.3)) - 1.0);
  ridge = pow(ridge, mix(2.0, 9.0, u_sharp));
  float heat = smoothstep(0.42 - u_density * 0.08, 0.86, f) + ridge * 0.45 * f;
  heat = clamp(heat * (0.7 + 0.45 * u_weight), 0.0, 1.0);
  vec3 col = palette(heat, false);
  float a = clamp(heat * 1.25, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(col * a, a);
}`,
  // Topography: contour lines of a slowly shifting landscape; with glow, neon.
  topo: `
void main() {
  vec2 p = place() * (1.6 / u_size) + seedShift();
  float t = u_t * 0.035;
  float h = fbm3(p * 0.8 + vec2(t, -t * 0.7)) + (0.15 + 0.5 * u_chaos) * fbm3(p * 2.1 - vec2(t * 1.3, 0.0));
  float levels = 5.0 + u_density * 9.0;
  float lv = h * levels;
  float d = abs(fract(lv) - 0.5);
  vec2 lg = lineGlow(0.5 - d, 0.025 + 0.05 * u_weight);
  vec3 col = palette(floor(lv) / levels * 1.7 + v_uv.x * 0.25, true);
  float a = clamp(lg.x + lg.y * 0.8, 0.0, 1.0) * u_strength;
  col = col * (1.0 + lg.y * 0.6) + lg.x * u_glow * 0.35;
  gl_FragColor = vec4(col * a, a);
}`,
  // Brush strokes: fine strands swirling round a centre, like a painted fur background.
  fur: `
float strandsAt(float flow, float r, float k) {
  float strands = fbm(vec2(flow * k, r * (70.0 + u_density * 50.0)) + seedShift());
  float fine = noise(vec2(flow * k * 2.0, r * 260.0));
  return strands * 0.85 + fine * 0.15;
}
void main() {
  vec2 p = (plane() - centre(u_pos)) / u_size;
  float r = length(p) + 0.0001;
  float a = atan(p.y, p.x);
  float t = u_t * 0.05;
  float wob = (fbm3(p * 1.5 + seedShift()) - 0.5) * (0.4 + u_chaos * 2.0);
  float rest = r * (1.6 + u_chaos * 2.5) + wob - t;
  float k = 2.0 + u_density * 2.5;
  // The angle jumps where it goes round: the strands there are blended with the other
  // side's, so no seam shows.
  float s2 = mix(
    strandsAt(a + rest, r, k),
    strandsAt(a - sign(a) * 6.2831853 + rest, r, k),
    0.5 * smoothstep(2.2, 3.1416, abs(a))
  );
  vec3 col = palette(clamp(v_uv.x * 0.45 + (1.0 - v_uv.y) * 0.55 + (s2 - 0.5) * 0.3, 0.0, 1.0), false);
  col *= 0.78 + 0.5 * pow(s2, mix(1.0, 2.2, u_sharp));
  col += pow(s2, 6.0) * 0.35 * u_weight;
  gl_FragColor = vec4(col * u_strength, u_strength);
}`,
  // A wall of motion lines: soft tapered streaks of light gliding by at several depths.
  streaks:
    STRANDS +
    `
void main() {
  vec2 p = place() / u_size;
  float rows = 8.0 + 14.0 * u_density;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= u_lines) break;
    vec4 s = strands(p, fi, rows, 1.0);
    col += s.rgb;
    a = max(a, s.a);
  }
  // Many lines over each other roll off softly toward white instead of burning out.
  col = 1.0 - exp(-col * 1.25);
  gl_FragColor = vec4(col * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Ribbon waves: silk ribbons flowing over each other, turning as they go, soft at the edges.
  ribbons: `
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.25;
  float n = min(40.0, (4.0 + floor(u_density * 5.0)) * u_lines);
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 40; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float h = hash1(fi);
    // How far away this ribbon is: far ones are narrow and dim, near ones wide and soft.
    float z = hash1(fi + 5.0);
    float ph = fi * 1.7;
    float y = ((fi + 0.5) / n - 0.5) * 1.05 + (h - 0.5) * 0.08
      + 0.09 * sin(p.x * (1.6 + h * 1.8) + t * (0.6 + hash1(fi + 1.0)) + ph)
      + u_bend * (0.24 * sin(p.x * 0.9 + t * 0.5 + ph * 0.35) + 0.07 * sin(p.x * 3.1 - t * 0.8 + ph))
      + u_chaos * 0.24 * (noise(vec2(p.x * 1.3 + t * 0.3, fi * 3.1)) - 0.5);
    float dy = p.y - y;
    // Silk turning as it flows: broad where it faces us, a thin bright edge where it is side-on.
    float face = 0.5 + 0.5 * sin(p.x * (1.1 + h) + t * (0.5 + 0.4 * h) + ph * 2.0);
    float w = (0.01 + 0.026 * u_weight) * mix(1.7, 0.45, z) * (0.1 + 0.9 * face);
    float soft = max(w * mix(0.9, 0.3, u_sharp), AA(dy) * 1.5);
    float band = 1.0 - smoothstep(max(w - soft, 0.0), w + soft, abs(dy));
    float sheen = 0.4 + 0.6 * smoothstep(-w, w, dy);
    float halo = exp(-abs(dy) / (w * 3.0 + 0.01)) * u_glow * 0.6;
    float k = (band * sheen * (1.1 - 0.5 * face) + halo) * mix(1.0, 0.4, z) * min(1.0, 3.6 * inversesqrt(n));
    col += palette(fi / n + h * 0.15, true) * k;
    a = max(a, k);
  }
  // Many lines over each other roll off softly toward white instead of burning out.
  col = 1.0 - exp(-col * 1.25);
  gl_FragColor = vec4(col * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Plasma: the classic flowing colour field.
  plasma: `
void main() {
  vec2 p = place() * (3.0 / u_size);
  float t = u_t * 0.35;
  float v = sin(p.x + t) + sin(p.y * 1.3 - t * 0.8) + sin((p.x + p.y) * 0.8 + t * 0.6)
    + sin(length(p + vec2(sin(t * 0.3), cos(t * 0.4)) * 2.0) * 1.6);
  v += u_chaos * 3.0 * (fbm3(p * 0.6 + seedShift() + t * 0.1) - 0.5);
  float x = v * 0.2 * (0.6 + u_density * 0.6);
  float edge = mix(0.5, 0.04, u_sharp);
  float st = floor(x * 4.0) / 4.0 + smoothstep(0.5 - edge, 0.5 + edge, fract(x * 4.0)) / 4.0;
  vec3 col = palette(mix(x, st, u_sharp), true);
  gl_FragColor = vec4(col * u_strength, u_strength);
}`,
  // Kaleidoscope: a slowly turning pattern folded into mirrored slices.
  kaleido: `
void main() {
  vec2 p = place() / u_size;
  float r = length(p);
  float seg = 6.2831853 / (6.0 + floor(u_density * 4.0) * 2.0);
  float a = mod(atan(p.y, p.x) + u_t * 0.05, seg);
  a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r * 2.5 + seedShift();
  float f = fbm3(q + vec2(u_t * 0.08, -u_t * 0.05)) + u_chaos * 0.6 * fbm3(q * 2.3);
  float x = f * 1.6 + r * 0.35 - u_t * 0.03;
  float edge = mix(0.5, 0.04, u_sharp);
  float st = floor(x * 3.0) / 3.0 + smoothstep(0.5 - edge, 0.5 + edge, fract(x * 3.0)) / 3.0;
  vec3 col = palette(mix(x, st, u_sharp), true);
  gl_FragColor = vec4(col * u_strength, u_strength);
}`,
  // Cells: drifting points with glowing borders between them.
  cells: `
void main() {
  vec2 p = place() * (2.5 + u_density * 3.0) / u_size;
  vec2 g = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 c = vec2(float(i), float(j));
      vec3 h = hash3(vec3(g + c, u_seed));
      vec2 o = 0.5 + 0.45 * sin(u_t * (0.25 + u_chaos * 0.8) + 6.2831 * h.xy);
      float d = length(c + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = h.z; }
      else if (d < d2) d2 = d;
    }
  vec2 lg = lineGlow(d2 - d1, 0.03);
  vec3 col = palette(id, true);
  float a = clamp(lg.x + lg.y * 0.8 + 0.12, 0.0, 1.0) * u_strength;
  col = mix(col * 0.35, col * (1.0 + lg.y * 0.5), clamp(lg.x + lg.y, 0.0, 1.0));
  gl_FragColor = vec4(col * a, a);
}`,
  // Hologram: an iridescent foil shifting its colours.
  holo: `
void main() {
  vec2 p = place() / u_size;
  float v = p.x * 0.8 + p.y * 0.4 + 0.35 * fbm3(p * 2.0 + seedShift() + u_t * 0.06)
    + sin(length(p) * 7.0 - u_t * 0.6) * (0.04 + 0.12 * u_chaos);
  v *= 0.8 + u_density * 0.8;
  vec3 col = u_paint > 0.5 ? palette(v, true) : 0.62 + 0.38 * cos(6.2831 * (v + vec3(0.0, 0.33, 0.67)));
  float sheen = pow(max(0.0, sin(v * 9.0 + u_t * 0.8)), mix(4.0, 30.0, u_sharp));
  col += sheen * 0.25;
  float a = 0.85 * u_strength;
  gl_FragColor = vec4(col * a, a);
}`,
  // The sun: a bright disc, a wide glow and turning rays; with glow, lens flares toward
  // the middle. Placed anywhere (x / y), it can drift slowly.
  sun: `
void main() {
  vec2 c = centre(u_pos);
  if (u_mode > 0.5) c += 0.05 * vec2(sin(u_t * 0.11), cos(u_t * 0.083));
  vec2 p = plane() - c;
  float d = length(p) / u_size;
  float R = 0.045 + 0.05 * u_weight;
  float disc = 1.0 - smoothstep(R * 0.85, R, d);
  float glow = exp(-d / (R * 3.2)) * 0.9 + exp(-d / (R * 9.0)) * 0.35;
  float rays = pow(abs(cos(atan(p.y, p.x) * (4.0 + floor(u_density * 6.0)) + u_t * 0.06)), 18.0);
  rays *= exp(-d / (R * 8.0)) * 0.6;
  float flare = 0.0;
  vec2 axis = -c;
  for (int i = 1; i <= 3; i++) {
    float k = float(i) * 0.55;
    float q = length(plane() - (c + axis * k));
    flare += (1.0 - smoothstep(0.02 * float(i), 0.03 * float(i) + 0.01, q)) * 0.18;
  }
  flare *= u_glow;
  vec3 col = u_c[0] * disc + u_c[1] * glow + u_c[2] * rays + u_c[1] * flare;
  float a = clamp(disc + glow + rays + flare, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(col * u_strength, a);
}`,
  // Sunburst: stripes of light turning round a point, as on a retro poster.
  sunburst: `
void main() {
  vec2 p = plane() - centre(u_pos);
  float n = 8.0 + floor(u_density * 10.0);
  float a = atan(p.y, p.x) + u_t * 0.04;
  float s = sin(a * n);
  float edge = max(mix(0.6, 0.02, u_sharp), AA(s) * 1.2);
  float stripe = smoothstep(-edge, edge, s);
  vec3 col = mix(u_c[0], u_c[1], stripe);
  float fade = 1.0 - smoothstep(0.0, 1.4, length(p));
  float al = u_strength * (0.55 + 0.45 * fade);
  gl_FragColor = vec4(col * al, al);
}`,
  // A halo: a soft spot of light with a faint ring, breathing.
  halo: `
void main() {
  vec2 c = centre(u_pos);
  if (u_mode > 0.5) c += 0.06 * vec2(sin(u_t * 0.13), cos(u_t * 0.09));
  float d = length(plane() - c) / u_size;
  float R = 0.12 + 0.12 * u_weight;
  float breathe = 0.9 + 0.1 * sin(u_t * 0.7);
  float spot = exp(-(d * d) / (R * R * 0.6)) * breathe;
  float ring = exp(-pow((d - R * 1.25) / (0.015 + 0.02 * u_glow), 2.0)) * (0.25 + 0.5 * u_glow);
  vec3 col = u_c[0] * spot + u_c[1] * ring;
  float a = clamp(spot + ring, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(col * u_strength, a);
}`,
  // Wave lines: many glowing lines riding one big slow wave, bunching and spreading.
  wavelines: `
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.25;
  float n = 5.0 + u_density * 9.0;
  // Big slow waves bend the whole sheet; lines further down are squeezed and spread
  // differently, which gives the sheet its depth.
  float wave = sin(p.x * 2.2 + t + p.y * 2.0);
  float y = p.y + (0.26 + 0.14 * u_chaos) * wave + 0.09 * sin(p.x * 1.1 - t * 0.7 + p.y * 4.0)
    + u_chaos * 0.12 * (fbm3(vec2(p.x * 0.9 + t * 0.2, p.y * 2.0)) - 0.5);
  float g = y * n;
  float d = abs(fract(g) - 0.5);
  vec2 lg = lineGlow(0.5 - d, 0.035 + 0.05 * u_weight);
  float crest = 0.45 + 0.55 * (0.5 + 0.5 * wave);
  vec3 col = palette(clamp(v_uv.x * 0.75 + v_uv.y * 0.3, 0.0, 1.0), false);
  float a = clamp(lg.x * crest + lg.y * 0.7, 0.0, 1.0) * u_strength;
  col *= 1.0 + lg.y * 0.5;
  gl_FragColor = vec4(col * a, a);
}`,
  // Speed tunnel: streaks of light rushing out from a point (place it anywhere).
  tunnel: `
void main() {
  vec2 p = plane() - centre(u_pos);
  float r = length(p) + 0.0001;
  float turn = atan(p.y, p.x) / 6.2831853 + 0.5;
  float n = 50.0 + u_density * 110.0;
  float id = floor(turn * n);
  float h = hash1(id);
  float across = abs(fract(turn * n) - 0.5) * 2.0;
  float thin = 1.0 - smoothstep(0.15 + 0.35 * u_weight * h, 0.45 + 0.4 * u_weight, across);
  float speed = 0.6 + h * 1.4 + u_chaos * hash1(id + 3.0) * 2.0;
  float f = fract(log(r) * 1.4 - u_t * speed * 0.5 + h * 10.0);
  float lenf = 0.3 + 0.5 * hash1(id + 5.0);
  float dash = smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(lenf * 0.7, lenf, f));
  float far = smoothstep(0.02, 0.45, r);
  float k = thin * dash * far * (0.35 + 0.65 * hash1(id + 7.0));
  float core = exp(-r * 5.0) * (0.25 + 0.5 * u_glow);
  vec3 col = palette(1.0 - v_uv.y, false);
  float a = clamp(k * (1.0 + u_glow) + core, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4((col * a + u_c[0] * core * 0.2) * u_strength, a);
}`,
  // Fluid folds: soft ridges of colour, lit from the top left, slowly shifting.
  dunes: `
float ridge(vec2 p, float t) {
  float w = fbm3(p * 0.6 + vec2(t, -t * 0.6) + seedShift()) * (2.5 + u_chaos * 4.0);
  return sin(p.x * (2.0 + u_density * 2.0) + p.y * 3.5 + w);
}
void main() {
  vec2 p = place() * (2.0 / u_size);
  float t = u_t * 0.05;
  float e = 0.012;
  float h = ridge(p, t);
  float hx = (ridge(p + vec2(e, 0.0), t) - h) / e;
  float hy = (ridge(p + vec2(0.0, e), t) - h) / e;
  float bump = 0.35 * (0.5 + u_weight);
  vec3 nrm = normalize(vec3(-hx * bump, -hy * bump, 1.0));
  float light = dot(nrm, normalize(vec3(-0.5, 0.6, 0.75)));
  vec3 col = palette(clamp(v_uv.x * 0.6 + (1.0 - v_uv.y) * 0.4 + h * 0.06, 0.0, 1.0), false);
  col *= 0.5 + 0.65 * light;
  col += pow(max(light, 0.0), 24.0) * (0.3 - 0.2 * u_sharp);
  gl_FragColor = vec4(col * u_strength, u_strength);
}`,
  // Falling light: soft strands of light pouring down at several depths, heads feathered, tails fading.
  lightfall:
    STRANDS +
    `
void main() {
  vec2 p = place() / u_size;
  float rows = 14.0 + 24.0 * u_density;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= u_lines) break;
    // The same strands stood upright: along them is down the picture.
    vec4 s = strands(vec2(p.y, p.x), fi, rows, 0.0);
    col += s.rgb;
    a = max(a, s.a);
  }
  // Many lines over each other roll off softly toward white instead of burning out.
  col = 1.0 - exp(-col * 1.25);
  gl_FragColor = vec4(col * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Rising lines: lines of light sweep in along the floor, bend upward and rise, with
  // pulses of light running up them.
  risers: `
void main() {
  vec2 P0 = plane() / u_size;
  float aspect = u_res.x / u_res.y;
  float n = min(54.0, (8.0 + floor(u_density * 10.0)) * u_lines);
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 54; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float h = hash1(fi);
    // How far away this line is: each depth has its own floor, width and brightness, so
    // the lines never pile into one bright bar.
    float z = hash1(fi + 7.0);
    float y0 = -0.4 + z * 0.14;
    vec2 P = P0;
    // Bend: the rising part sways like a reed, more the higher it is.
    P.x += smoothstep(y0, y0 + 0.4, P.y)
      * (u_bend * 0.07 * sin(P.y * 4.5 + u_t * 0.35 + h * 6.2831853)
        + u_chaos * 0.06 * (noise(vec2(P.y * 3.0 + u_t * 0.1, fi * 1.9)) - 0.5));
    float xi = (h * 2.0 - 1.0) * 0.46 * aspect;
    float s = xi < 0.0 ? -1.0 : 1.0;
    float R = 0.05 + abs(xi) * 0.7 + 0.08 * hash1(fi + 1.0);
    vec2 c = vec2(xi + s * R, y0 + R);
    float d;
    float L;
    float reach = 1.0;
    if (P.y >= c.y) {
      d = abs(P.x - xi);
      L = R * 1.5708 + (P.y - c.y);
    } else if ((P.x - c.x) * s >= 0.0) {
      d = abs(P.y - y0);
      L = -abs(P.x - c.x);
      // Along the floor the line fades in from nothing instead of starting as a bar.
      reach = exp(L * 10.0);
    } else {
      vec2 q = P - c;
      d = abs(length(q) - R);
      L = R * atan(abs(q.x), -q.y);
    }
    float top = 0.5 * hash1(fi + 2.0);
    float fade = 1.0 - smoothstep(top - 0.12, top + 0.34, P.y);
    vec2 lg = lineGlow(d, (0.001 + 0.0022 * u_weight) * mix(1.7, 0.6, z));
    // Light breathing up the line in soft swells (no sudden starts).
    float f = L * (2.0 + u_chaos * 3.0) - u_t * (0.3 + h * 0.5) + h * 9.0;
    float pulse = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(6.2831853 * f), 3.0);
    float k = clamp(lg.x + lg.y * 0.7, 0.0, 1.0) * fade * reach * pulse * mix(1.0, 0.45, z);
    col += palette(hash1(fi + 3.0), true) * k;
    a = max(a, k);
  }
  // Many lines over each other roll off softly toward white instead of burning out.
  col = 1.0 - exp(-col * 1.25);
  gl_FragColor = vec4(col * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Neon grid: a glowing floor racing toward a bright horizon (synthwave).
  synthgrid: `
void main() {
  vec2 p = plane();
  float hz = 0.05;
  vec3 col = vec3(0.0);
  float a = 0.0;
  // Worked out for every pixel (derivatives must not sit inside a branch), used below the horizon.
  float depth = max(hz - p.y, 0.001);
  float z = 1.0 / (depth + 0.02);
  float gx = p.x * z * (0.8 + u_density * 0.6);
  float gz = z * (0.35 + u_density * 0.25) + u_t * 0.5;
  float w = 0.02 + 0.04 * u_weight;
  vec2 g1 = lineGlow(0.5 - abs(fract(gx) - 0.5), w);
  vec2 g2 = lineGlow(0.5 - abs(fract(gz) - 0.5), w);
  // Far lines closer together than a few pixels would shimmer: they fade into the horizon.
  float far = 1.0 - smoothstep(0.2, 0.55, max(AA(gx), AA(gz)));
  if (p.y < hz) {
    float k = (max(g1.x, g2.x) + (g1.y + g2.y) * 0.5) * far;
    a = clamp(k * smoothstep(0.0, 0.2, depth), 0.0, 1.0);
    col = mix(u_c[1], u_c[0], smoothstep(0.0, 0.45, depth)) * a;
  }
  float glow = exp(-abs(p.y - hz) * 16.0) * (0.3 + 0.5 * u_glow);
  col += u_c[2] * glow;
  a = clamp(a + glow, 0.0, 1.0);
  gl_FragColor = vec4(col * u_strength, a * u_strength);
}`,
  // Spiral: arms of colour turning inward, hypnotic.
  spiral: `
void main() {
  vec2 p = place() / u_size;
  float r = length(p) + 0.0001;
  float arms = 2.0 + floor(u_density * 3.0);
  float x = atan(p.y, p.x) / 6.2831853 * arms + log(r) * (1.2 + u_chaos * 2.0) - u_t * 0.15
    + (fbm3(p * 2.0 + seedShift()) - 0.5) * u_chaos;
  // The edge's width from how fast angle and distance change here (the angle itself jumps
  // round the back, which would draw a line).
  float px = length(AA2(p)) / r;
  float edge = max(mix(0.5, 0.04, u_sharp), 2.0 * (arms / 6.2831853 + 1.2 + u_chaos * 2.0) * px);
  float st = floor(x * 2.0) / 2.0 + smoothstep(0.5 - edge, 0.5 + edge, fract(x * 2.0)) / 2.0;
  vec3 col = palette(mix(x, st, u_sharp), true);
  gl_FragColor = vec4(col * u_strength, u_strength);
}`,
  // Gradient stripes: bold diagonal bands sliding along, gently waving.
  stripes: `
void main() {
  vec2 p = place() / u_size;
  float n = 1.0 + u_density * 2.2;
  float wv = sin(p.y * 3.0 + u_t * 0.4) * (0.04 + 0.25 * u_chaos);
  float g = (p.x + p.y * 0.6 + wv) * n - u_t * 0.3;
  float f = fract(g);
  float edge = max(mix(0.2, 0.01, u_sharp), AA(g) * 1.2);
  float band = smoothstep(0.0, edge, f) * (1.0 - smoothstep(0.5, 0.5 + edge, f));
  vec3 base = palette(clamp(v_uv.x * 0.7 + v_uv.y * 0.3, 0.0, 1.0), false);
  vec3 col = mix(base * 0.5, base * (1.0 + 0.12 * u_weight), band);
  col += pow(max(0.0, 1.0 - abs(f - 0.25) * 4.0), 6.0) * 0.15 * u_weight;
  gl_FragColor = vec4(col * u_strength, u_strength);
}`,
  // Aurora: two soft curtains of the colours drifting and slowly changing hue, with faint
  // rays in them. (The CSS one animated a blur filter: repainted in full every frame.)
  aurora: `
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.1;
  float soft = mix(1.0, 0.4, u_sharp);
  float reach = u_res.x / u_res.y * 0.5 + 0.2;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float y0 = fi < 0.5 ? 0.3 : -0.33;
    float yc = y0 + 0.1 * sin(p.x * 1.7 + t * (1.0 + fi * 0.3) + fi * 2.0) + 0.05 * sin(p.x * 3.1 - t * 0.7);
    float d = (p.y - yc) / (0.2 * soft);
    float band = exp(-d * d);
    float rays = 0.6 + 0.4 * fbm3(vec2(p.x * 7.0 + t * 0.8 + fi * 7.0, p.y * 0.5));
    float ends = smoothstep(-reach, -reach * 0.3, p.x) * (1.0 - smoothstep(reach * 0.3, reach, p.x));
    float k = band * rays * ends * 0.6;
    col += palette(p.x * 0.35 + fi * 0.4 + t * 0.35, true) * k;
    a = max(a, k);
  }
  gl_FragColor = vec4(col * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Goo: drops of the colours drifting and melting into each other where they touch.
  goo: `
void main() {
  vec2 p = plane() / u_size;
  float aspect = u_res.x / u_res.y;
  float t = u_t * 0.35;
  float field = 0.0;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(
      (hash1(fi) - 0.5) * aspect * 0.8 + 0.18 * sin(t * (0.6 + hash1(fi + 1.0) * 0.6) + fi * 2.1),
      (hash1(fi + 2.0) - 0.5) * 0.8 + 0.2 * cos(t * (0.5 + hash1(fi + 3.0) * 0.6) + fi * 1.3)
    );
    float r = 0.1 + 0.08 * hash1(fi + 4.0);
    float d = length(p - c);
    float w = r * r / (d * d + 0.0004);
    field += w;
    float m = mod(fi, 3.0);
    vec3 cc = m < 0.5 ? u_c[0] : m < 1.5 ? u_c[1] : u_c[2];
    col += cc * w;
    wsum += w;
  }
  float a = smoothstep(0.9, 1.15, field) * 0.55 * u_strength;
  col = col / max(wsum, 0.0001);
  gl_FragColor = vec4(col * a, a);
}`,
  // Nebula: clouds of coloured gas slowly folding, with stars twinkling through them.
  nebula: `
void main() {
  vec2 p = place() * (1.4 / u_size) + seedShift();
  float t = u_t * 0.03;
  vec2 q = vec2(fbm(p + vec2(t, -t * 0.6)), fbm(p + vec2(5.2, 1.3) - t * 0.5));
  float n = fbm(p * (0.8 + u_density * 0.5) + q * (1.2 + u_chaos * 2.5));
  float cloud = smoothstep(mix(0.25, 0.45, u_sharp), 0.85, n);
  vec3 col = palette(n * 1.3 + q.x * 0.5, false) * (0.3 + cloud * 1.2);
  vec2 sp = plane() * 46.0;
  vec2 id = floor(sp);
  vec2 f = fract(sp) - 0.5;
  float h = hash(id + u_seed);
  vec2 off = (vec2(hash(id + 7.3), hash(id + 2.9)) - 0.5) * 0.6;
  float tw = 0.45 + 0.55 * sin(u_t * (0.8 + h * 2.5) + h * 40.0);
  float star = step(0.9, h) * (1.0 - smoothstep(0.0, 0.1 + 0.08 * u_weight, length(f - off))) * tw;
  col += vec3(star);
  float a = clamp(cloud * 0.95 + star, 0.0, 1.0) * u_strength;
  gl_FragColor = overSpace(vec4(min(col, vec3(1.0)) * a, a));
}`,
  // Clouds: soft banks of cloud drifting sideways, lit from above.
  clouds: `
void main() {
  vec2 p = place() * (1.2 / u_size) + seedShift();
  p.x += u_t * 0.04;
  float warp = fbm3(p * 0.7 - u_t * 0.01) * u_chaos * 1.5;
  float n = fbm(p * vec2(1.0, 1.8) * (0.7 + u_density * 0.5) + warp);
  float lo = mix(0.38, 0.48, u_sharp);
  float c = smoothstep(lo, lo + mix(0.4, 0.12, u_sharp), n);
  float shade = fbm3(p * 2.0 + 3.0);
  vec3 col = mix(u_c[1], u_c[0], smoothstep(0.25, 0.75, shade));
  float a = c * 0.9 * u_strength;
  gl_FragColor = vec4(col * a, a);
}`,
  // Water light: the bright net of light that ripples on the bottom of a pool.
  caustics: `
void main() {
  vec2 p = mod(place() * (3.2 * u_density / u_size) + seedShift(), 6.2831853) - 250.0;
  float t = u_t * 0.35 + 23.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x)) * (0.7 + u_chaos);
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  float k = clamp(pow(abs(c), mix(6.0, 12.0, u_sharp)), 0.0, 1.0);
  vec3 col = mix(u_c[0], u_c[1], k) + k * 0.35 * u_weight;
  float a = clamp(0.4 + k, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(min(col, vec3(1.0)) * a, a);
}`,
  // Ink in water: billows of colour unfolding and rising.
  ink: `
void main() {
  vec2 p = place() * (1.3 / u_size) + seedShift();
  float t = u_t * 0.06;
  vec2 w = vec2(fbm3(p * 1.5 + vec2(0.0, t)), fbm3(p * 1.5 + vec2(4.0, -t)));
  float n = fbm(p * (0.6 + u_density * 0.8) + (w - 0.5) * (2.0 + u_chaos * 4.0) + vec2(0.0, -t * 2.0));
  float a = smoothstep(0.3, mix(0.62, 0.38, u_sharp), n);
  vec3 col = palette(w.x * 1.2 + n * 0.4, false) * (0.75 + 0.5 * w.y);
  a *= 0.92 * u_strength;
  gl_FragColor = vec4(min(col, vec3(1.0)) * a, a);
}`,
  // Lightning: forked bolts flashing down and dying away, the sky lit for a moment.
  lightning: `
void main() {
  vec2 p = plane() / u_size;
  float aspect = u_res.x / u_res.y;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float n = 1.0 + floor(u_density * 1.6);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float ph = u_t * (0.45 + 0.1 * fi) + hash1(fi) * 10.0;
    float cell = floor(ph);
    float f = fract(ph);
    float on = step(0.15, hash1(cell * 1.7 + fi * 13.0));
    float env = on * exp(-f * 3.0) * (0.65 + 0.35 * sin(f * 80.0));
    float cx = (hash1(cell + fi * 3.1) - 0.5) * aspect * 0.8;
    float x = cx + (fbm(vec2(p.y * 3.0, cell * 3.7 + fi * 7.0)) - 0.5) * (0.25 + 0.6 * u_chaos)
      + (noise(vec2(p.y * 16.0, cell)) - 0.5) * 0.035;
    float d = abs(p.x - x);
    vec2 lg = lineGlow(d, 0.002 + 0.003 * u_weight);
    float k = (lg.x + lg.y * 0.8 + 0.004 / (d + 0.012)) * env;
    col += mix(u_c[0], vec3(1.0), lg.x) * k;
    a = max(a, clamp(k, 0.0, 1.0));
    float sky = env * 0.12 * exp(-abs(p.x - cx) * 1.5);
    col += u_c[1] * sky;
    a = max(a, sky);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Pulse rings: rings of light spreading out from a point, like a signal or a heartbeat.
  pulserings: `
void main() {
  vec2 p = (plane() - centre(u_pos)) / u_size;
  float r = length(p);
  float n = 2.0 + floor(u_density * 3.0);
  float x = r * n - u_t * 0.35;
  float d = abs(fract(x) - 0.5) / n;
  vec2 lg = lineGlow(d, 0.004 + 0.008 * u_weight);
  float fade = exp(-r * 1.1);
  float k = clamp(lg.x + lg.y + 0.012 / (d + 0.02), 0.0, 1.0) * fade;
  vec3 col = palette(fract(floor(x) * 0.21), true);
  gl_FragColor = vec4(col * k * u_strength, k * u_strength);
}`,
  // Honeycomb: a net of six-sided cells, each lighting up and fading in its own time.
  honeycomb: `
vec4 hexCell(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return vec4(g, p - g);
}
void main() {
  vec2 p = place() * (5.0 * (0.5 + u_density * 0.5) / u_size) + seedShift();
  vec4 h = hexCell(p);
  vec2 q = abs(h.xy);
  float d = 0.5 - max(dot(q, vec2(0.5, 0.8660254)), q.x);
  vec2 lg = lineGlow(d, 0.015 + 0.02 * u_weight);
  float ph = hash(floor(h.zw * 10.0 + 0.5) + 1.7);
  float lit = pow(0.5 + 0.5 * sin(u_t * (0.4 + ph * (0.6 + u_chaos)) + ph * 40.0), 4.0);
  float fill = lit * 0.7 * smoothstep(0.0, 0.35, d);
  float line = clamp(lg.x + lg.y, 0.0, 1.0);
  vec3 col = palette(ph, true) * fill + u_c[0] * line * 0.9;
  float a = clamp(fill + line * 0.9, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, a);
}`,
  // Dot wave: a field of dots swelling and shrinking as waves pass through it.
  dotwave: `
void main() {
  vec2 p = place() / u_size;
  float n = 6.0 + 14.0 * u_density;
  vec2 g = p * n;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float wv = sin(id.x * 0.45 + u_t * 0.9 + id.y * 0.2) * cos(id.y * 0.4 - u_t * 0.6)
    + (fbm3(id * 0.15 + seedShift()) - 0.5) * 1.2 * u_chaos;
  float s = clamp(0.5 + 0.5 * wv, 0.0, 1.0);
  float r = (0.14 + 0.28 * s) * min(1.3, u_weight);
  float soft = max(mix(0.12, 0.03, u_sharp), AA(g.x) * 1.2);
  float dotk = 1.0 - smoothstep(r - soft, r + soft * 0.5, length(f));
  vec3 col = palette(s, false);
  float a = dotk * (0.5 + 0.5 * s) * u_strength;
  gl_FragColor = vec4(col * a, a);
}`,
  // Grainy gradient: big soft patches of the colours drifting, under fine film grain.
  grainient: `
void main() {
  vec2 p = place() / u_size;
  float aspect = u_res.x / u_res.y;
  p += (vec2(fbm3(p * 1.5 + seedShift()), fbm3(p * 1.5 + seedShift() + 7.0)) - 0.5) * u_chaos * 0.6;
  float t = u_t * 0.08;
  vec3 col = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = 0.42 * vec2(sin(t * (0.7 + fi * 0.23) + fi * 2.4 + u_seed) * aspect,
                         cos(t * (0.5 + fi * 0.31) + fi * 1.7 + u_seed * 0.3));
    float d = length(p - c) * (0.6 + u_density * 0.4);
    float w = 1.0 / (pow(d, 2.0 + u_sharp * 2.0) + 0.02);
    col += u_c[i] * w;
    ws += w;
  }
  col /= ws;
  float g = hash(floor(v_uv * u_res) + floor(u_t * 12.0) * 17.0) - 0.5;
  col += g * (0.03 + 0.05 * u_weight);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * u_strength, u_strength);
}`,
  // Stage beams: cones of coloured light sweeping down from above through haze.
  beams: `
void main() {
  vec2 p = plane();
  float aspect = u_res.x / u_res.y;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float n = 3.0 + floor(u_density * 2.0);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= n) break;
    vec2 o = vec2(((fi + 0.5) / n - 0.5) * aspect, 0.56);
    float ang = sin(u_t * (0.35 + 0.12 * hash1(fi)) + hash1(fi + 2.0) * 6.2831853) * (0.3 + 0.5 * u_chaos);
    vec2 dir = vec2(sin(ang), -cos(ang));
    vec2 q = p - o;
    float along = dot(q, dir);
    float across = abs(q.x * dir.y - q.y * dir.x);
    float width = (0.015 + 0.14 * max(along, 0.0)) * u_weight * u_size;
    float b = along > 0.0
      ? (1.0 - smoothstep(width * mix(0.15, 0.8, u_sharp), width, across)) * exp(-along * 1.1)
      : 0.0;
    float dust = 0.7 + 0.3 * fbm3(q * 6.0 + u_t * 0.1);
    float k = b * dust;
    col += palette(hash1(fi + 5.0), true) * k;
    a = max(a, k);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Stained glass: panes of coloured glass in dark lead, light slowly passing behind them.
  stainedglass: `
void main() {
  vec2 p = place() * (3.0 * u_density / u_size) + seedShift();
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 id = n;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash3(vec3(n + g, u_seed)).xy;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = n + g; }
      else if (d < d2) { d2 = d; }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float lw = 0.03 * u_weight;
  float lead = smoothstep(lw, lw + max(0.035, AA(edge) * 1.5), edge);
  float h = hash(id + 3.7);
  vec3 glass = palette(h, true);
  float light = 0.8 + 0.3 * sin(u_t * 0.5 + h * 20.0 + (p.x + p.y) * 0.6);
  light *= 0.85 + 0.35 * fbm3(p * 3.0);
  vec3 col = glass * light * lead + vec3(0.03) * (1.0 - lead);
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, u_strength);
}`,
  // Cross of light: a glowing cross with a halo and slow rays behind it.
  crossglow: `
float boxDist(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  vec2 p = (plane() - centre(u_pos)) / (u_size * (0.6 + 0.4 * u_weight));
  float th = 0.032;
  float d = min(boxDist(p - vec2(0.0, -0.03), vec2(th, 0.3)), boxDist(p - vec2(0.0, 0.08), vec2(0.17, th)));
  float core = 1.0 - smoothstep(0.0, max(mix(0.02, 0.004, u_sharp), AA(d) * 1.5), d);
  float halo = exp(-max(d, 0.0) * (10.0 - 6.0 * u_glow)) * (0.6 + 0.15 * sin(u_t * 0.8));
  vec2 c = p - vec2(0.0, 0.08);
  float ang = atan(c.y, c.x);
  float rays = pow(0.5 + 0.5 * sin(ang * (6.0 + floor(u_density * 6.0)) + u_t * 0.15), 3.0)
    * exp(-length(c) * 2.2) * 0.55;
  rays *= 0.7 + 0.3 * sin(ang * 3.0 - u_t * 0.3);
  vec3 col = u_c[0] * core + u_c[1] * halo * (1.0 - core) + u_c[2] * rays * (1.0 - core);
  float a = clamp(core + halo * 0.85 + rays, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, a);
}`,
  // Thread wave: hundreds of hair-thin parallel threads lying on a slowly rolling surface;
  // light grazes the crests and the troughs fall into darkness.
  threadwave: `
float twDisp(vec2 p, float t) {
  float a = sin(p.x * 1.9 + t + 1.4 * sin(p.y * 1.1 - t * 0.35));
  float b = sin(p.x * 3.7 - t * 0.7 + p.y * 2.6);
  return 0.22 * a + 0.07 * b
    + u_chaos * 0.16 * (fbm3(vec2(p.x * 1.1 + t * 0.15, p.y * 1.3) + seedShift()) - 0.5);
}
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.22;
  float n = 30.0 + 70.0 * u_density;
  float e = 0.01;
  float h = twDisp(p, t);
  float hx = (twDisp(p + vec2(e, 0.0), t) - h) / e;
  float hy = (twDisp(p + vec2(0.0, e), t) - h) / e;
  float g = (p.y + h) * n;
  float d = 0.5 - abs(fract(g) - 0.5);
  float w = 0.07 + 0.09 * u_weight;
  float fw = AA(g);
  float soft = max(mix(0.14, 0.05, u_sharp), fw * 1.2);
  float line = 1.0 - smoothstep(w, w + soft, d);
  // Where the threads crowd closer than the pixels can show, they melt into their
  // average tone instead of shimmering (moiré).
  line = mix(line, min(1.0, 2.0 * w + soft), smoothstep(0.45, 1.0, fw));
  // The slope toward the light: crests facing it shine, the far sides go dark.
  float lit = clamp(0.5 - 1.5 * hx - 0.9 * hy, 0.0, 1.0);
  lit = lit * lit * (3.0 - 2.0 * lit);
  float deep = smoothstep(-0.3, 0.35, h + 0.25 * (fbm3(p * 0.7 + seedShift() + 3.0) - 0.5));
  float shade = pow(lit, 1.7) * (0.3 + 0.7 * deep);
  vec3 tone = palette(shade, false);
  float halo = u_glow * exp(-d / (w * 3.0)) * 0.5 * shade;
  vec3 col = u_c[0] * 0.04 + tone * (line * 1.7 * shade + halo) + u_c[1] * line * 0.16 * (0.4 + 0.6 * deep);
  col += vec3(1.0) * line * pow(shade, 3.0) * 0.6;
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, u_strength);
}`,
  // Particle wave: a floor of glowing dots seen in perspective, rolling like a sea and
  // fading into the distance.
  particlewave: `
float pwH(vec2 w, float t) {
  return 0.5 * sin(w.x * 1.5 + t) * cos(w.y * 1.1 - t * 0.6)
    + 0.3 * sin(w.x * 0.6 + w.y * 0.85 + t * 0.8)
    + u_chaos * 0.5 * sin(w.x * 2.6 - w.y * 2.0 + t * 1.3 + u_seed);
}
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.5;
  float focal = 0.9;
  float camH = 1.0;
  float horizon = 0.27;
  float dz = 0.21 / (0.55 + 0.45 * u_density);
  float px = 1.0 / u_res.y;
  // The rows come toward the eye; each keeps its own number, so nothing jumps when the
  // nearest one leaves and a new one appears far away (both faded).
  float scroll = u_t * 0.3 / dz;
  float k0 = floor(scroll);
  float fr = scroll - k0;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 44; i++) {
    float fi = float(i);
    float row = fi + 1.0 - fr;
    float z = 1.1 + row * dz;
    float X = p.x * z / focal;
    float cx = (floor(X / dz) + 0.5) * dz;
    float h = pwH(vec2(cx, (fi + k0) * dz), t);
    vec2 s = vec2(cx, h * 0.42 - camH) * (focal / z) + vec2(0.0, horizon);
    float r = (0.05 + 0.05 * u_weight) * dz * focal / z;
    // A dot smaller than a pixel is drawn a pixel big and fainter, so far rows don't flicker.
    float rr = max(r, px * 0.9);
    float d = length(p - s);
    float k = (1.0 - smoothstep(rr * mix(0.2, 0.7, u_sharp), rr + px, d)) * min(1.0, (r * r) / (rr * rr) + 0.25);
    k += u_glow * 0.6 * exp(-d / (rr * 2.5));
    float up = 0.5 + 0.5 * clamp(h / (1.0 + 0.5 * u_chaos), -1.0, 1.0);
    float fade = smoothstep(0.0, 1.5, row) * (1.0 - smoothstep(34.0, 43.0, row)) * exp(-z * 0.1);
    k *= fade * (0.4 + 1.1 * up * up);
    col += palette(up, false) * k;
    a = max(a, k);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Liquid metal: dark mirror chrome flowing in slow swirls, bright studio highlights and
  // a thin-film sheen of the colours (gloss = how much sheen).
  liquidmetal: `
float lmH(vec2 p, float t) {
  vec2 q = vec2(fbm3(p + vec2(0.0, t)), fbm3(p + vec2(5.2, 1.3) - t));
  return fbm3(p * 0.9 + (q - 0.5) * (1.5 + 3.5 * u_chaos) + t * 0.3);
}
void main() {
  vec2 p = place() * ((0.9 + 0.5 * u_density) / u_size) + seedShift();
  float t = u_t * 0.05;
  float e = 0.03;
  float h = lmH(p, t);
  float hx = (lmH(p + vec2(e, 0.0), t) - h) / e;
  float hy = (lmH(p + vec2(0.0, e), t) - h) / e;
  vec3 n = normalize(vec3(-hx, -hy, 0.55));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  // What the metal mirrors: a dark room with long soft lamps.
  float k = mix(3.0, 6.0, u_sharp);
  float env = pow(0.5 + 0.5 * sin(r.y * 6.0 + r.x * 2.5 + h * 4.0), k) * 0.9
    + pow(0.5 + 0.5 * sin(r.x * 5.0 - r.y * 2.0 + 1.3), k * 1.6) * 0.5;
  float fres = pow(1.0 - n.z, 2.0);
  float spec = pow(max(dot(n, normalize(vec3(0.35, 0.55, 0.75))), 0.0), 50.0);
  vec3 sheen = palette(h * 2.2 + r.x * 0.5 + r.y * 0.35 + t * 0.6, true);
  vec3 metal = vec3(0.03, 0.035, 0.05) + vec3(0.6, 0.66, 0.78) * env;
  float s = clamp(0.55 * u_weight, 0.0, 1.0);
  vec3 col = mix(metal, sheen * (0.12 + 1.5 * env) + sheen * fres * 0.6, s) + vec3(spec) * 0.9;
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, u_strength);
}`,
  // Curtains of light: tall blurred bands of colour sliding sideways behind each other.
  curtains: `
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.035;
  p.x += u_chaos * 0.14 * sin(p.y * 1.7 + t * 4.0 + u_seed);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = p.x * (2.2 + fi * 1.6) * (0.5 + 0.5 * u_density) + t * (1.0 + fi * 0.7) + fi * 17.3 + u_seed * 1.7;
    float a = noise(vec2(x, fi * 3.1 + 0.5));
    float b = noise(vec2(x * 2.3 + 5.0, fi * 7.7 + 0.5));
    float band = smoothstep(mix(0.2, 0.42, u_sharp), mix(0.8, 0.62, u_sharp), a) * (0.55 + 0.45 * b);
    float fold = 0.6 + 0.4 * sin(p.y * (1.1 + fi * 0.45) + a * 5.0 + t * 3.0 + fi * 2.0);
    col += palette(b * 0.8 + fi * 0.27 + a * 0.35, true) * band * fold * (1.0 - fi * 0.15);
  }
  col = 1.0 - exp(-col * col * 2.6);
  col += u_c[0] * 0.03;
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, u_strength);
}`,
  // Glass shards: see-through angular pieces of coloured glass with bright cut edges,
  // drifting and slowly turning over each other.
  shards: `
void main() {
  vec2 p = place() / u_size;
  float aspect = u_res.x / u_res.y;
  float n = 6.0 + floor(u_density * 6.0);
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 21; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float h = hash1(fi);
    float h2 = hash1(fi + 9.0);
    vec2 c = vec2((h - 0.5) * (aspect + 0.3), (h2 - 0.5) * 1.3)
      + 0.1 * vec2(sin(u_t * (0.11 + 0.1 * h2) + h * 6.28), cos(u_t * (0.09 + 0.1 * h) + h2 * 6.28));
    float rot = hash1(fi + 3.0) * 6.2831853 + u_t * (hash1(fi + 4.0) - 0.5) * (0.08 + 0.3 * u_chaos);
    float sz = (0.1 + 0.2 * hash1(fi + 5.0)) * u_weight;
    vec2 q = p - c;
    float d = -10.0;
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      float ang = rot + fj * 2.0943951 + (hash1(fi * 3.0 + fj + 20.0) - 0.5) * 1.1;
      d = max(d, dot(q, vec2(cos(ang), sin(ang))) - sz * (0.45 + 0.6 * hash1(fi * 5.0 + fj + 40.0)));
    }
    float cover = 1.0 - aaStep(0.0, d);
    float edge = exp(min(d, 0.0) * 70.0) * cover;
    float g = clamp(0.5 + dot(q, vec2(cos(rot + 0.7), sin(rot + 0.7))) / (sz * 1.6), 0.0, 1.0);
    vec3 tint = palette(hash1(fi + 6.0), true);
    float body = cover * (0.16 + 0.5 * g * g);
    vec3 light = tint * body * 1.25 + mix(tint, vec3(1.0), 0.65) * edge * (0.55 + 0.6 * u_glow);
    float al = clamp(body + edge * 0.8, 0.0, 1.0);
    col = col * (1.0 - al * 0.45) + light;
    a = a + (1.0 - a) * al;
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Fluted glass: a soft drifting gradient seen through ribbed glass — every narrow rib
  // bends the picture behind it, with a bright edge on one side and a dark one on the other.
  fluted: `
vec3 flBack(vec2 q, float t) {
  q += (vec2(fbm3(q * 1.1 + seedShift() + t * 0.25), fbm3(q * 1.1 + seedShift() + 7.0 - t * 0.25)) - 0.5)
    * (0.2 + 1.1 * u_chaos);
  vec3 col = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(0.55 * sin(t * (0.7 + fi * 0.23) + fi * 2.4 + u_seed),
                  0.45 * cos(t * (0.5 + fi * 0.31) + fi * 1.7 + u_seed * 0.3));
    float d = length(q - c);
    float w = 1.0 / (d * d * d * d + 0.004);
    col += u_c[i] * w;
    ws += w;
  }
  return col / ws;
}
/** What one rib shows at f across it (0…1; a little beyond for smoothing its edges). */
vec3 flRib(vec2 p, float id, float f, float n, float t) {
  float depth = min(u_weight, 2.5);
  // The rib is a lens: it shows a wider, mirrored slice of what is behind it, and each
  // rib sits a little higher or lower than its neighbours (the comb edge).
  vec2 q = vec2((id + 0.5) / n - (f - 0.5) * 0.2 * depth,
                p.y + (hash1(id * 1.37) - 0.5) * 0.16 * depth);
  vec3 col = flBack(q, t);
  float dp = min(depth, 1.5);
  col *= 1.0 - 0.5 * dp * exp(-(1.0 - f) * 5.0);
  col += (0.12 + 0.88 * col) * 0.55 * dp * exp(-max(f, 0.0) * 8.0);
  return col;
}
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.12;
  float n = 12.0 + 33.0 * u_density;
  float s = p.x * n;
  float id = floor(s);
  float f = s - id;
  float side = f < 0.5 ? -1.0 : 1.0;
  vec3 a = flRib(p, id, f, n, t);
  vec3 b = flRib(p, id + side, f - side, n, t);
  float aw = max(mix(0.05, 0.0, u_sharp), AA(s));
  float k = 0.5 * (1.0 - smoothstep(0.0, aw, min(f, 1.0 - f)));
  vec3 col = mix(a, b, k);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * u_strength, u_strength);
}`,
  // Dust in a sunbeam: fine glowing motes at different depths, the near and far ones out
  // of focus, all drifting slowly.
  dust:
    MOTES +
    `
void main() {
  vec2 p = place() / u_size;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float keep = clamp(0.5 * u_density, 0.08, 1.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float sc = 2.4 * pow(1.75, fi);
    float blur = abs(fi - 2.5) / 2.5;
    vec2 q = p * sc + vec2(u_t * 0.035, u_t * 0.02) + fi * 13.7
      + u_chaos * 0.5 * vec2(sin(u_t * 0.13 + fi * 2.1), cos(u_t * 0.11 + fi));
    float r = mix(0.035, 0.17, blur * blur) * min(u_weight, 1.6);
    vec3 m = mote(q, r, mix(0.03, 0.1, blur), keep, fi, 0.06);
    float tw = 0.55 + 0.45 * sin(u_t * (0.4 + m.y * 1.3) + m.y * 50.0);
    float k = m.x * tw * mix(1.3, 0.3, blur) * (0.3 + 0.7 * m.y * m.y);
    col += mix(palette(m.y, true), vec3(1.0), 0.35 * (1.0 - blur)) * k;
    a = max(a, k);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Swarm: bright specks streaming along the lines of a wandering current, each with a
  // soft tail behind it.
  swarm: `
void main() {
  vec2 p = place() / u_size;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 w = p * (1.0 + 0.35 * fi) + fi * 7.3;
    // The current's lanes: lines of equal psi. Specks stay in their lane as it bends.
    float psi = w.y + (0.25 + 1.1 * u_chaos) * (fbm3(w * 1.2 + seedShift() + vec2(u_t * 0.015, 0.0)) - 0.5);
    float g = psi * (8.0 + 7.0 * fi) * u_density;
    float lane = floor(g);
    float px = AA(g) + 1e-4;
    float d = abs(fract(g) - 0.5) / px;
    float wpx = (0.7 + 0.8 * u_weight) / (1.0 + 0.3 * fi);
    float line = 1.0 - smoothstep(wpx * 0.5, wpx * 0.5 + 1.2, d);
    float h = hash1(lane + fi * 57.0);
    float along = (w.x + 0.2 * fbm3(w * 0.7 + 3.0)) * (1.3 + 1.2 * h);
    float f = fract(along - u_t * (0.1 + 0.16 * h) + h * 17.0);
    float tip = AA(along) * 1.5 + 1e-4;
    float tail = pow(f, 7.0) * 0.75 + exp(-(1.0 - f) * 45.0);
    tail *= 1.0 - smoothstep(1.0 - tip, 1.0, f);
    float k = (line + u_glow * 0.7 * exp(-d / (wpx * 3.0))) * tail * (1.0 - 0.22 * fi);
    col += mix(palette(h, true), vec3(1.0), 0.5 * exp(-(1.0 - f) * 45.0)) * k;
    a = max(a, k);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Galaxy: a tilted spiral of stars and dust slowly turning round a bright core.
  galaxy: `
void main() {
  vec2 p = (plane() - centre(u_pos)) / (u_size * 1.5);
  float ca = cos(u_angle), sa = sin(u_angle);
  p = mat2(ca, -sa, sa, ca) * p;
  p.y /= 0.58;
  float r = length(p);
  float rot = u_t * 0.04;
  // Two arms: the angle taken twice, so the picture has no seam where the angle wraps.
  float s = 2.0 * atan(p.y, p.x) - log(r + 0.03) * (3.0 + 2.5 * u_density) + 2.0 * rot;
  float arm = pow(0.5 + 0.5 * cos(s), mix(1.4, 3.5, u_sharp));
  float cr = cos(rot), sr = sin(rot);
  vec2 rp = mat2(cr, -sr, sr, cr) * p;
  float dust = fbm(rp * 5.0 + seedShift());
  float fine = fbm(rp * 11.0 + seedShift() + 4.0);
  float disc = exp(-r * 2.8) * smoothstep(0.0, 0.12, r);
  float arms = arm * (0.25 + 1.3 * mix(dust, dust * fine * 2.0, u_chaos)) * disc;
  float lanes = 1.0 - 0.6 * arm * smoothstep(0.45, 0.75, fine);
  float haze = exp(-r * 4.5) * 0.25;
  float core = exp(-r * 22.0) * 1.3 + exp(-r * 8.0) * 0.35;
  vec2 sg = rp * 55.0;
  vec2 sid = floor(sg);
  vec3 sh = hash3(vec3(sid, 3.0 + u_seed));
  float sd = length(fract(sg) - 0.5 - (sh.xy - 0.5) * 0.6);
  float star = step(1.0 - (0.06 + 0.5 * arm) * disc * 1.6 - 0.02, sh.z)
    * (1.0 - smoothstep(0.03, 0.16, sd)) * (0.6 + 0.4 * sin(u_t * (0.6 + sh.x * 2.0) + sh.y * 40.0));
  vec3 col = u_c[0] * core
    + mix(u_c[2], u_c[1], smoothstep(0.1, 0.8, arm)) * arms * 1.7 * lanes
    + u_c[3] * pow(dust, 3.0) * arm * disc * 1.6
    + u_c[2] * haze
    + mix(u_c[1], vec3(1.0), 0.6) * star;
  float a = clamp(core + arms * 1.4 + haze + star, 0.0, 1.0);
  gl_FragColor = overSpace(vec4(min(col, vec3(1.0)) * a, a) * u_strength);
}`,
  // Deep starfield: layers of stars sliding past at different depths, twinkling; a few
  // bright ones with the cross-shaped glint of a telescope.
  starfield:
    MOTES +
    `
void main() {
  vec2 p = place() / u_size;
  vec3 col = vec3(0.0);
  float a = 0.0;
  vec2 slide = vec2(u_t * 0.012, u_t * 0.004);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float sc = 7.0 * pow(1.8, fi) * sqrt(u_density);
    vec3 m = mote(p * sc + slide + fi * 31.7, 0.04 * min(u_weight, 2.0), 0.03, 0.34, fi + 10.0, 0.0);
    float mag = m.y * m.y * m.y;
    float tw = 0.65 + 0.35 * sin(u_t * (0.7 + m.y * 2.4) + m.y * 70.0);
    float k = m.x * tw * (0.12 + 1.2 * mag) * (1.0 - 0.15 * fi);
    col += mix(vec3(1.0), palette(fract(m.y * 7.3), true), 0.55) * k;
    a = max(a, k);
  }
  // The few bright ones, nearest, with long thin rays.
  vec2 q = p * 2.3 * sqrt(u_density) + slide * 1.6 + 5.3;
  vec2 id = floor(q);
  vec3 h = hash3(vec3(id, 77.0 + u_seed));
  vec2 f = fract(q) - 0.5 - (h.xy - 0.5) * 0.5;
  float on = step(h.z, 0.45);
  float tw = 0.75 + 0.25 * sin(u_t * (0.9 + h.x) + h.y * 30.0);
  float sz = (0.6 + 0.6 * h.x) * min(u_weight, 2.0);
  float d = length(f);
  float core = exp(-d * 70.0 / sz) * 1.5 + exp(-d * 16.0 / sz) * 0.22;
  float ray = exp(-abs(f.y) * 190.0) * exp(-abs(f.x) * 13.0 / sz) + exp(-abs(f.x) * 190.0) * exp(-abs(f.y) * 13.0 / sz);
  // Nothing of a star may reach its cell's edge (it would be cut off there).
  vec2 g = abs(fract(q) - 0.5);
  float inside = 1.0 - smoothstep(0.36, 0.5, max(g.x, g.y));
  float k = on * tw * inside * (core + ray * 0.75);
  col += mix(vec3(1.0), palette(h.z * 2.2, true), 0.35) * k;
  a = max(a, k);
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = overSpace(vec4(min(col, vec3(1.0)), a) * u_strength);
}`,
  // Planet: a turning banded world lit from one side, its air glowing at the rim, with a
  // ring round it (the ring knob takes it away).
  planet: `
void main() {
  vec2 q = (plane() - centre(u_pos)) / u_size;
  float R = 0.2 * (0.5 + 0.5 * u_weight);
  float d = length(q);
  float la = 2.3 - u_angle;
  vec3 L = normalize(vec3(cos(la), sin(la), 0.5));
  float disc = 1.0 - aaStep(R, d);
  vec3 n = vec3(q / R, sqrt(max(1.0 - d * d / (R * R), 0.0)));
  // Its axis leans a little; it turns round it.
  float tl = 0.35;
  vec3 m = vec3(n.x * cos(tl) + n.y * sin(tl), -n.x * sin(tl) + n.y * cos(tl), n.z);
  float rt = u_t * 0.05;
  vec3 rp = vec3(m.x * cos(rt) + m.z * sin(rt), m.y, -m.x * sin(rt) + m.z * cos(rt));
  vec2 sp = vec2(rp.x * 1.3 + rp.z * 0.9, rp.y * (2.0 + 3.0 * u_density)) + seedShift();
  float swirl = fbm3(vec2(rp.x * 3.0 - rp.z * 2.0, rp.y * 5.0) + seedShift() + 9.0);
  float bands = fbm(sp + vec2(swirl * (0.3 + 2.2 * u_chaos), 0.0));
  bands = smoothstep(0.25, 0.75, bands + 0.25 * sin(rp.y * (5.0 + 7.0 * u_density) + swirl * 2.0));
  float diff = smoothstep(-0.12, 0.65, dot(n, L));
  float rim = pow(1.0 - n.z, 2.5);
  vec3 body = mix(u_c[1], u_c[0], bands) * (0.03 + 1.1 * diff) + u_c[2] * rim * (0.08 + 1.2 * diff);
  float outside = max(d - R, 0.0);
  float halo = exp(-outside / (R * (0.1 + 0.3 * u_glow)))
    * (0.2 + 0.8 * clamp(dot(q / max(d, 1e-4), L.xy) * 0.9 + 0.5, 0.0, 1.0)) * 0.8;
  vec3 col = body * disc + u_c[2] * halo * (1.0 - disc);
  float a = disc + halo * (1.0 - disc);
  // The ring: a flat disc seen nearly edge-on, in front of the planet below, behind it above.
  float rc = cos(0.3), rs = sin(0.3);
  vec2 rq = mat2(rc, -rs, rs, rc) * q;
  rq.y /= 0.26;
  float rr = length(rq) / R;
  float ring = smoothstep(1.35, 1.45, rr) * (1.0 - smoothstep(2.15, 2.3, rr))
    * (0.45 + 0.55 * noise(vec2(rr * 13.0, u_seed)));
  // A dark gap part of the way out, as Saturn's rings have.
  ring *= 1.0 - 0.75 * (1.0 - smoothstep(1.78, 1.84, rr)) * smoothstep(1.72, 1.78, rr);
  ring *= u_sharp * (rq.y < 0.0 ? 1.0 : 1.0 - disc);
  // The planet's shadow falls across the far side of the ring.
  float lit = 0.35 + 0.65 * smoothstep(-0.3, 0.5, dot(normalize(vec3(q, 0.0) + vec3(0.0, 0.0, 0.2)), L));
  col = col * (1.0 - ring * 0.85) + u_c[3] * ring * lit;
  a = a + (1.0 - a) * ring;
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = overSpace(vec4(min(col, vec3(1.0)), a) * u_strength);
}`,
  // Garland: strings of small warm lamps hung across, swaying a little, each twinkling
  // in its own time; a further string out of focus behind.
  garland: `
float gaY(float x, float fi, float sway) {
  return 0.34 - fi * 0.3 + (0.07 + 0.02 * fi) * cos(x * (4.2 - fi * 0.9) + fi * 2.3 + sway) * (1.0 + 0.5 * sway);
}
void main() {
  vec2 p = place() / u_size;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    // The last string hangs further away: bigger soft lights, no wire to see.
    float far = fi > 1.5 ? 1.0 : 0.0;
    float sway = 0.12 * sin(u_t * (0.5 + 0.13 * fi) + fi * 1.9);
    float nb = (10.0 + 2.0 * fi) * u_density * (1.0 - 0.45 * far);
    float wy = abs(p.y - gaY(p.x, fi, sway));
    float wire = (1.0 - smoothstep(0.0015, 0.0015 + max(0.002, AA(p.y) * 1.2), wy)) * (1.0 - far) * 0.75;
    col = col * (1.0 - wire) + vec3(0.1, 0.17, 0.12) * wire;
    a = a + (1.0 - a) * wire;
    float ci = floor(p.x * nb);
    for (int j = -1; j <= 1; j++) {
      float id = ci + float(j);
      float cx = (id + 0.5) / nb;
      vec2 c = vec2(cx, gaY(cx, fi, sway) - 0.016 * (1.0 - far));
      float d = length(p - c);
      float h = hash1(id + fi * 31.0);
      float tw = 0.5 + 0.5 * sin(u_t * (0.5 + 1.6 * h) + h * 40.0);
      tw = 0.3 + 0.7 * tw * tw;
      float rb = 0.015 * u_weight * (1.0 + 2.6 * far);
      float core = 1.0 - smoothstep(rb * mix(0.55, 0.1, far), rb, d);
      // The glow dies away before the third lamp along (only the nearest three are drawn).
      float halo = exp(-d / (rb * (2.2 + 3.5 * u_glow))) * 0.6
        * (1.0 - smoothstep(0.8, 1.5, abs(p.x - cx) * nb));
      vec3 tint = palette(hash1(id * 1.7 + fi * 13.0 + 5.0), true);
      float k = (core * mix(1.0, 0.3, far) + halo * mix(1.0, 0.35, far)) * tw;
      col += tint * k + vec3(1.0) * core * tw * 0.45 * (1.0 - far);
      a = max(a, clamp(k, 0.0, 1.0));
    }
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Star of Bethlehem: one great star with long rays — the longest reaching down —
  // breathing softly, small stars round it.
  bethlehem:
    MOTES +
    `
void main() {
  vec2 q = (plane() - centre(u_pos)) / (u_size * (0.55 + 0.45 * u_weight));
  float d = length(q);
  float tw = 0.86 + 0.1 * sin(u_t * 1.1) + 0.05 * sin(u_t * 2.7 + 1.0);
  float core = exp(-d * 42.0) * 1.8;
  float halo = exp(-d * (8.0 - 4.5 * u_glow)) * 0.5;
  float w = mix(0.008, 0.0045, u_sharp);
  float len = 0.9 + 0.1 * sin(u_t * 0.7 + 2.0);
  float rv = exp(-abs(q.x) / w) * exp(-abs(q.y) / ((q.y < 0.0 ? 0.36 : 0.2) * len));
  float rh = exp(-abs(q.y) / w) * exp(-abs(q.x) / (0.15 * len));
  vec2 dq = mat2(0.7071, -0.7071, 0.7071, 0.7071) * q;
  float rd = (exp(-abs(dq.x) / (w * 0.8)) * exp(-abs(dq.y) / 0.07)
    + exp(-abs(dq.y) / (w * 0.8)) * exp(-abs(dq.x) / 0.07)) * 0.55;
  // Fine rays between the great ones, slowly turning (a whole number of them: no seam).
  float ang = atan(q.y, q.x);
  float fine = pow(0.5 + 0.5 * sin(ang * (4.0 + 2.0 * floor(u_density * 3.0)) + u_t * 0.12), 6.0)
    * exp(-d * 9.0) * 0.35;
  float rays = (rv + rh + rd) * tw;
  vec3 col = u_c[0] * (core + rays) + u_c[1] * (halo + fine + rays * 0.4) + u_c[2] * exp(-d * 2.4) * 0.22;
  float a = core + halo + rays + fine + exp(-d * 2.4) * 0.2;
  vec2 p = plane() / u_size;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec3 m = mote(p * (9.0 + 8.0 * fi) + fi * 11.0, 0.045, 0.035, 0.4, fi + 20.0, 0.0);
    float k = m.x * (0.3 + 0.7 * m.y) * (0.6 + 0.4 * sin(u_t * (0.6 + m.y * 2.0) + m.y * 60.0)) * 0.8;
    col += vec3(k);
    a += k;
  }
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, a * u_strength);
}`,
  // Christmas snow: deep soft snowfall — small sharp flakes far away, big blurred ones
  // floating past the eye.
  xmassnow:
    MOTES +
    `
void main() {
  vec2 p = place() / u_size;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float keep = clamp(0.55 * u_density, 0.1, 1.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    // Layer 0 is nearest the eye (big, out of focus), the last is far away.
    float sc = 1.7 * pow(1.62, fi);
    float near = 1.0 - fi / 5.0;
    float blur = near * near;
    vec2 q = p * sc + fi * 23.1
      + vec2(sin(u_t * 0.21 + fi * 1.7) * (0.25 + 0.6 * u_chaos), u_t * (0.16 + 0.03 * fi));
    float r = mix(0.045, 0.2, blur) * min(u_weight, 1.5);
    vec3 m = mote(q, r, mix(0.035, 0.11, blur), keep, fi + 30.0, 0.07);
    float k = m.x * mix(0.95, 0.2, blur) * (0.6 + 0.4 * m.y);
    col += mix(u_c[0], u_c[1], m.y) * k;
    a = max(a, k);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // Candlelight: big soft circles of warm light out of focus, each flickering like a flame.
  candles:
    MOTES +
    `
void main() {
  vec2 p = place() / u_size;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float keep = clamp(0.5 * u_density, 0.1, 1.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float sc = 1.5 + 1.1 * fi;
    vec2 q = p * sc + fi * 9.7 + vec2(sin(u_t * 0.07 + fi) * 0.2, u_t * 0.012);
    float r = (0.2 - 0.03 * fi) * min(u_weight, 1.4);
    vec3 m = mote(q, r, 0.05, keep, fi + 40.0, 0.03);
    // A flame's flicker: slow breathing with quick small shivers.
    float fl = 0.6 + 0.28 * noise(vec2(u_t * 1.7 + m.y * 90.0, m.y * 13.0))
      + 0.12 * noise(vec2(u_t * 6.0 + m.y * 40.0, 3.0));
    float bokeh = 0.72 + 0.28 * smoothstep(0.6, 1.0, m.z);
    float k = m.x * fl * bokeh * (0.75 - 0.1 * fi);
    col += palette(m.y, true) * k;
    a = max(a, k);
  }
  // The warm air low down, where the candles stand.
  float low = exp(-(plane().y + 0.5) * 3.0) * 0.3;
  col += u_c[0] * low;
  a = max(a, low);
  gl_FragColor = vec4(min(col, vec3(1.0)) * u_strength, clamp(a, 0.0, 1.0) * u_strength);
}`,
  // A poster colour layer that moves: its gradient flows along its angle, turns, or
  // breathes into its colours the other way round.
  fill: `
void main() {
  vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float c = cos(u_angle), s = sin(u_angle);
  vec2 dir = vec2(s, c);
  float along = dot(p, dir) / (abs(dir.x) * u_res.x / u_res.y + abs(dir.y)) + 0.5;
  float radial = length(p) / length(vec2(u_res.x / u_res.y, 1.0) * 0.5);
  vec3 col;
  if (u_mode < 0.5) {
    col = palette(along - u_t * 0.125, true);
  } else if (u_mode < 1.5) {
    if (u_paint > 0.5) col = palette(atan(p.x, p.y) / 6.2831853 - u_t / 14.0, true);
    else {
      float r = u_t / 14.0 * 6.2831853;
      vec2 d2 = vec2(sin(u_angle + r), cos(u_angle + r));
      col = palette(dot(p, d2) / length(vec2(u_res.x / u_res.y, 1.0)) + 0.5, false);
    }
  } else {
    float g = u_paint > 0.5 ? radial : along;
    float k = 0.5 - 0.5 * cos(u_t / 5.0 * 6.2831853);
    col = mix(palette(g, false), palette(1.0 - g, false), k);
  }
  gl_FragColor = vec4(col, 1.0);
}`,
};

// ---------- The one context ----------

interface Gl {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /**
   * Hand-over: the finished picture is passed to the block's canvas without copying
   * (OffscreenCanvas → ImageBitmap → a "bitmaprenderer" canvas). Copying it with drawImage
   * made the browser wait for the graphics chip on every frame — measured on a big
   * full-screen window it took 85% of the time and the editor stuttered. Phones without
   * OffscreenCanvas WebGL (iOS before 17) still copy.
   */
  handover: boolean;
  programs: Partial<
    Record<ShaderKind, { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> }>
  >;
}
let shared: Gl | null = null;
let broken = false;

function context(): Gl | null {
  if (shared || broken) return shared;
  const opts: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  };
  try {
    let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
    let gl: WebGLRenderingContext | null = null;
    let handover = false;
    if (
      typeof OffscreenCanvas !== 'undefined' &&
      typeof ImageBitmapRenderingContext !== 'undefined'
    ) {
      try {
        const off = new OffscreenCanvas(1, 1);
        gl = off.getContext('webgl', opts) as WebGLRenderingContext | null;
        if (gl) {
          canvas = off;
          handover = true;
        }
      } catch {
        gl = null;
      }
    }
    if (!gl) {
      const el = document.createElement('canvas');
      el.width = MAX_SIDE;
      el.height = MAX_SIDE;
      gl = el.getContext('webgl', { ...opts, preserveDrawingBuffer: true });
      canvas = el;
    }
    if (!gl || !canvas) {
      broken = true;
      return null;
    }
    // The phone may take the context back (memory, background): start again next frame.
    (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', (e: Event) => {
      e.preventDefault();
      shared = null;
    });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    shared = { gl, canvas, programs: {}, handover };
    return shared;
  } catch {
    broken = true;
    return null;
  }
}

const UNIFORMS = [
  'u_res',
  'u_t',
  'u_c',
  'u_n',
  'u_strength',
  'u_density',
  'u_weight',
  'u_sharp',
  'u_chaos',
  'u_seed',
  'u_angle',
  'u_size',
  'u_mode',
  'u_paint',
  'u_glow',
  'u_pos',
  'u_bg',
  'u_lines',
  'u_bend',
];

/** Kinds whose shader didn't compile here: not tried again every frame (that alone lags). */
const failed = new Set<ShaderKind>();

function program(g: Gl, kind: ShaderKind) {
  const have = g.programs[kind];
  if (have) return have;
  if (failed.has(kind)) throw new Error('shader failed before');
  const { gl } = g;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  try {
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    // Smooth edges where the phone can measure them (nearly all can: WebGL 1's derivatives).
    const ext = gl.getExtension('OES_standard_derivatives')
      ? '#extension GL_OES_standard_derivatives : enable\n'
      : '';
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, ext + COMMON + FRAGMENTS[kind]));
    gl.bindAttribLocation(prog, 0, 'a');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
  } catch (e) {
    failed.add(kind);
    throw e;
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const u of UNIFORMS) loc[u] = gl.getUniformLocation(prog, u);
  const p = { prog, loc };
  g.programs[kind] = p;
  return p;
}

/** '#rrggbb' or a computed 'rgb(…)' / 'color(srgb …)' to 0…1 red, green, blue. */
export function parseColor(c: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);
  if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])];
  return null;
}

/** The block's own colours (the ministry's --live-a/b/c), read through a probe element. */
function ownColors(el: Element): [number, number, number][] {
  // The colours are defined on .living-bg itself, so the probe wears that class.
  const probe = document.createElement('i');
  probe.className = 'living-bg';
  probe.style.display = 'none';
  el.appendChild(probe);
  const out: [number, number, number][] = [];
  for (const v of ['--live-a', '--live-c', '--live-b']) {
    probe.style.color = `var(${v}, #888)`;
    const c = parseColor(getComputedStyle(probe).color);
    if (c) out.push(c);
  }
  probe.remove();
  return out.length ? out : [[0.9, 0.3, 0.2]];
}

/** The colours each kind uses when the block gives none of its own. */
const MARBLE = ['#f3f0ea', '#d8d2c8', '#6f6a64', '#c9a24a'];
const OWN_DEFAULTS: Partial<Record<ShaderKind, string[]>> = {
  marble: MARBLE,
  // Dark ember → orange → gold → white heat.
  flames: ['#3b0a00', '#b45309', '#f59e0b', '#fff3c4'],
  // Violet → red → orange → yellow, as a painted fur background.
  fur: ['#6d28d9', '#e11d48', '#f97316', '#facc15'],
  // Neon violet, magenta, cyan.
  topo: ['#a855f7', '#ec4899', '#22d3ee', '#6366f1'],
  // Core, glow, rays.
  sun: ['#fffbe8', '#ffd166', '#ff9f43'],
  sunburst: ['#ffcf66', '#ff8a3d'],
  halo: ['#fff6d8', '#ffd38a'],
  // Electric blue → violet → cyan, as glowing data waves.
  wavelines: ['#2563eb', '#7c3aed', '#22d3ee'],
  // Blue at the top, violet, red at the bottom: the speed-lines look.
  tunnel: ['#2563eb', '#8b5cf6', '#ff2d55'],
  lightfall: ['#ff4fd8', '#8b5cf6', '#3b82f6'],
  risers: ['#22d3ee', '#a855f7', '#ff4f7b', '#60a5fa'],
  // Grid near, grid far, horizon glow.
  synthgrid: ['#ff2bd6', '#7c3aed', '#22d3ee'],
  nebula: ['#1e1b4b', '#7c3aed', '#ec4899', '#22d3ee'],
  // Lit tops, shaded undersides.
  clouds: ['#ffffff', '#b9c8e6'],
  // Deep water, light.
  caustics: ['#0e7490', '#a5f3fc'],
  // Bolt, sky flash.
  lightning: ['#c4b5fd', '#6366f1'],
  stainedglass: ['#b91c1c', '#1d4ed8', '#f59e0b', '#15803d'],
  // The cross, its halo, the rays.
  crossglow: ['#fffdf2', '#ffd98a', '#ffb45e'],
  // Darkness, deep blue, light blue: light grazing a dark cloth.
  threadwave: ['#0b1e6b', '#2563eb', '#9bd4ff'],
  particlewave: ['#1d4ed8', '#22d3ee', '#e0f7ff'],
  // The thin-film sheen over the chrome.
  liquidmetal: ['#7c3aed', '#22d3ee', '#f0abfc', '#fde68a'],
  curtains: ['#2563eb', '#a855f7', '#ec4899', '#22d3ee'],
  shards: ['#22d3ee', '#a855f7', '#ff4f7b', '#fbbf24'],
  // Navy, royal blue, cyan, pale blue.
  fluted: ['#0a1a4f', '#1d4ed8', '#22d3ee', '#bfe9ff'],
  dust: ['#fff3d6', '#ffd9a0', '#ffffff'],
  swarm: ['#22d3ee', '#a855f7', '#f0abfc', '#60a5fa'],
  // Core, arms, dust between them, young blue stars.
  galaxy: ['#fff4d6', '#8fb4ff', '#c084fc', '#67e8f9'],
  starfield: ['#ffffff', '#bcd4ff', '#ffe2b8'],
  // Light bands, dark bands, the air, the ring.
  planet: ['#f4c38a', '#8a4b2a', '#7cc4ff', '#e9d8b8'],
  garland: ['#ffe2a6', '#ffb347', '#ff8a5c', '#fff1d0'],
  // The star, its halo and rays, the far glow.
  bethlehem: ['#fffdf2', '#ffe08a', '#8fb4ff'],
  xmassnow: ['#ffffff', '#dbeafe'],
  candles: ['#ffb347', '#ff8a3d', '#ffd98a', '#fff1c9'],
};

// ---------- One block ----------

class Painter {
  params: ShaderParams;
  colors: [number, number, number][] = [];
  last = -1;
  held = false;
  /**
   * How far into its animation it is, in its own seconds: the clock adds each tick's time
   * times the speed. Changing the speed then carries on from where it is (multiplying the
   * clock by the speed made the picture leap to another moment at every step of the slider).
   */
  phase = Math.random() * 40;
  private ctx: CanvasRenderingContext2D | null = null;
  private bitmap: ImageBitmapRenderingContext | null = null;
  width = 0;
  height = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly clip: HTMLElement,
    params: ShaderParams,
  ) {
    // The block's canvas takes the finished picture as it is (hand-over), or copies it.
    if (context()?.handover) this.bitmap = canvas.getContext('bitmaprenderer');
    else this.ctx = canvas.getContext('2d');
    this.params = params;
    this.setParams(params);
  }

  setParams(p: ShaderParams) {
    this.params = p;
    const list = p.colors.map(parseColor).filter((c): c is [number, number, number] => !!c);
    const own = OWN_DEFAULTS[p.kind];
    this.colors = list.length ? list : own ? own.map((c) => parseColor(c)!) : ownColors(this.clip);
    // Kinds that use their colours by place (marble's veins, the sun's core and rays) take
    // the missing ones from their own set.
    if (
      own &&
      (p.kind === 'marble' ||
        p.kind === 'sun' ||
        p.kind === 'sunburst' ||
        p.kind === 'halo' ||
        p.kind === 'clouds' ||
        p.kind === 'caustics' ||
        p.kind === 'lightning' ||
        p.kind === 'crossglow' ||
        p.kind === 'galaxy' ||
        p.kind === 'planet' ||
        p.kind === 'bethlehem' ||
        p.kind === 'xmassnow')
    )
      while (this.colors.length < own.length)
        this.colors.push(parseColor(own[this.colors.length]!)!);
    this.last = -1;
  }

  resize() {
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const lite = getQuality() === 'lite';
    const res = RES[this.params.kind];
    // Sharpness wanted (picture pixels per page pixel), never under its floor.
    const floor = (res >= 0.4 ? 1 : 0.75) * (lite ? 0.8 : 1);
    let k = recordingFull
      ? Math.max(floor, density(res) * Math.min(3, recordingScale || dpr))
      : Math.max(floor, density(res) * dpr) * (lite ? 0.75 : 1);
    // A slow phone draws everything smaller for a while (`adapt`, not under 60 %).
    if (!recordingFull) k *= adapt;
    const budget = recordingFull
      ? BUDGET_RECORDING
      : res >= 0.6 && !lite
        ? BUDGET_CRISP
        : BUDGET_SOFT;
    k = Math.min(k, Math.sqrt(budget / (w * h)));
    this.width = Math.max(1, Math.round(w * k));
    this.height = Math.max(1, Math.round(h * k));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
    this.last = -1;
  }

  /** One more picture, `dt` seconds after the last (the clock's way of drawing). */
  step(dt: number) {
    this.phase += dt * this.params.speed;
    this.draw(this.phase, true);
  }

  /** The picture `seconds` in (a recording's way), or exactly at `seconds` when `own`. */
  draw(seconds: number, own = false) {
    if (!this.ctx && !this.bitmap) return;
    if (!this.width) this.resize();
    if (!this.width) return;
    const g = context();
    if (!g) return;
    const { gl } = g;
    if (gl.isContextLost()) return;
    let p;
    try {
      p = program(g, this.params.kind);
    } catch (e) {
      if (import.meta.env.DEV) console.error('shader', this.params.kind, e);
      return;
    }
    const q = this.params;
    // Hand-over: the off-screen picture is exactly this block's size. Copying: the shared
    // canvas grows to the biggest block (pictures are drawn in its bottom left corner).
    if (g.handover && (g.canvas.width !== this.width || g.canvas.height !== this.height)) {
      g.canvas.width = this.width;
      g.canvas.height = this.height;
    } else if (!g.handover && (g.canvas.width < this.width || g.canvas.height < this.height)) {
      g.canvas.width = Math.max(g.canvas.width, this.width);
      g.canvas.height = Math.max(g.canvas.height, this.height);
    }
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(p.prog);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const c = this.colors;
    const flat = new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      const col = c[Math.min(i, c.length - 1)]!;
      flat.set(col, i * 3);
    }
    gl.uniform2f(p.loc.u_res!, this.width, this.height);
    gl.uniform1f(p.loc.u_t!, own ? seconds : seconds * q.speed);
    gl.uniform3fv(p.loc.u_c!, flat);
    gl.uniform1f(p.loc.u_n!, c.length);
    gl.uniform1f(p.loc.u_strength!, Math.min(1, q.strength));
    gl.uniform1f(p.loc.u_density!, q.density);
    gl.uniform1f(p.loc.u_weight!, q.weight);
    gl.uniform1f(p.loc.u_sharp!, q.sharp);
    gl.uniform1f(p.loc.u_chaos!, q.chaos);
    gl.uniform1f(p.loc.u_seed!, q.seed);
    gl.uniform1f(p.loc.u_angle!, (q.angle * Math.PI) / 180);
    gl.uniform1f(p.loc.u_size!, q.size);
    // Sun and halo: mode 1 = drifting.
    gl.uniform1f(p.loc.u_mode!, q.kind === 'sun' || q.kind === 'halo' ? (q.drift ? 1 : 0) : q.mode);
    // Silk and hologram: own colours change how they paint.
    gl.uniform1f(
      p.loc.u_paint!,
      q.kind === 'silk' || q.kind === 'holo' ? (q.colors.length ? 1 : 0) : q.paint,
    );
    gl.uniform1f(p.loc.u_glow!, q.glow);
    gl.uniform2f(p.loc.u_pos!, q.x, 1 - q.y);
    gl.uniform1f(p.loc.u_lines!, q.lines);
    gl.uniform1f(p.loc.u_bend!, q.bend);
    // The colour of space (alpha 0 = none chosen: the effect stays see-through).
    const bg = q.bg ? parseColor(q.bg) : null;
    gl.uniform4f(p.loc.u_bg!, bg?.[0] ?? 0, bg?.[1] ?? 0, bg?.[2] ?? 0, bg ? 1 : 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (g.handover && this.bitmap) {
      this.bitmap.transferFromImageBitmap((g.canvas as OffscreenCanvas).transferToImageBitmap());
      return;
    }
    if (!this.ctx) return;
    // The drawing sits at the bottom left of the shared canvas.
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(
      g.canvas,
      0,
      g.canvas.height - this.height,
      this.width,
      this.height,
      0,
      0,
      this.width,
      this.height,
    );
  }
}

// ---------- The shared clock ----------

const painters = new Set<Painter>();
let frame = 0;

const standing = () =>
  getMotion() === 'off' ||
  getQuality() === 'still' ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---------- Keeping up with the machine ----------

/**
 * How much of each kind's resolution is drawn now (1 = as designed), and how much longer
 * between frames (1 = 24 a second). The engine times its own drawing: a machine that can't
 * keep up — a computer whose Telegram draws without the graphics chip ("software"
 * graphics: old or blocked drivers, remote desktop), or a weak phone — gets smaller
 * pictures first (soft effects look the same), then fewer frames, so editing stays smooth.
 * A machine that keeps up easily climbs back to full quality.
 */
// Not remembered between sessions: one slow start (a shader compiling, a sheet opening)
// used to leave every later session blurry. Each session starts sharp and steps down if needed.
let adapt = 1;
/** While a poster is recorded its shaders are drawn at full resolution. */
let recordingFull = false;
/** The recording's own scale (its pixels per page pixel), so its shaders are drawn at its size. */
let recordingScale = 0;
let slowGap = 1;
/**
 * Drawing easily at full sharpness: the clock runs at 60 pictures a second instead of 30
 * (smooth, like a video). The first thing given up when drawing gets slow.
 */
let fast = false;
let slowTicks = 0;
let easyTicks = 0;
/** Drawing time a tick may take (ms) before it counts as slow: the rest is for the page. */
const BUDGET_MS = 10;

function resizeAll() {
  for (const p of painters) p.resize();
}

/** When the page last got a frame (the gap to the next one shows a busy graphics chip). */
let lastFrame = 0;

/**
 * `spent`: how long this tick's drawing took here. `frameGap`: the time since the page's
 * previous frame — the graphics chip's work isn't in `spent` (the picture is handed over
 * without waiting for it), but a busy chip makes frames come late, which this does see.
 */
function judge(spent: number, frameGap: number) {
  // At 60 a second a tick must leave the page more room than at 30; frames coming slower
  // than ~40 a second (60 mode) or ~22 a second (30 mode) count as slow too.
  const late = frameGap > (fast ? 25 : 45);
  if (spent > (fast ? BUDGET_MS * 0.6 : BUDGET_MS) || late) {
    easyTicks = 0;
    // Two slow ticks in a row (one alone may be a shader being compiled).
    if (++slowTicks < 2) return;
    slowTicks = 0;
    if (fast) fast = false;
    else if (adapt > SCALE_MIN) {
      adapt = stepScale(adapt, true);
      resizeAll();
    } else slowGap = Math.min(2.5, slowGap * 1.3);
  } else if (spent < BUDGET_MS * 0.35 && frameGap < 21) {
    slowTicks = 0;
    // Easy for a while: first back to full sharpness, then (a few seconds more) 60 a second.
    const full = slowGap === 1 && adapt >= 1;
    if (++easyTicks < (full ? 90 : 240)) return;
    easyTicks = 0;
    if (slowGap > 1) slowGap = Math.max(1, slowGap / 1.3);
    else if (adapt < 1) {
      adapt = stepScale(adapt, false);
      resizeAll();
    } else if (getQuality() === 'full') fast = true;
  } else slowTicks = 0;
}

function tick(now: number) {
  frame = 0;
  if (!painters.size) return;
  const before = lastFrame;
  lastFrame = now;
  const lite = getQuality() === 'lite';
  const gap = (1000 / (lite ? 20 : fast ? 60 : 30)) * slowGap;
  const html = document.documentElement;
  if (!document.hidden && !(lite && html.dataset.scrolling)) {
    const still = standing();
    const t0 = performance.now();
    let drew = false;
    for (const p of painters) {
      if (p.held) continue;
      if (p.clip.hasAttribute('data-off') && p.last >= 0) continue;
      if (still || p.clip.closest('.motion-still')) {
        if (p.last < 0) {
          p.draw(6);
          p.last = now;
        }
        continue;
      }
      // Sped up, it is drawn more often (up to 36 a second): fast movement stays smooth
      // instead of jumping from picture to picture.
      const quick = lite || fast ? 1 : Math.min(1.5, Math.max(1, p.params.speed));
      // A couple of ms early is on time: frames arrive a little unevenly (60 a second
      // would otherwise often skip to 30).
      if (now - p.last < gap / quick - 2) continue;
      // After a pause (off screen, another tab) it carries on, without leaping ahead.
      const dt = p.last < 0 ? 0 : Math.min(0.25, (now - p.last) / 1000);
      p.last = now;
      p.step(dt);
      drew = true;
    }
    // A long gap is a pause (another tab, the phone asleep), not slowness.
    const frameGap = before && now - before < 250 ? now - before : 0;
    if (drew) judge(performance.now() - t0, frameGap);
  }
  frame = requestAnimationFrame(tick);
}

function start(p: Painter) {
  painters.add(p);
  if (!frame) frame = requestAnimationFrame(tick);
}
function stop(p: Painter) {
  painters.delete(p);
  if (!painters.size && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}

/** Recording: draws the shader canvases inside `root` as they are `seconds` in. */
export function seekShaders(root: Element, seconds: number) {
  for (const p of painters) if (root.contains(p.clip)) p.draw(seconds);
}
/**
 * Recording: stops (or restarts) their clock while it steps them, and draws them at the
 * recording's own `scale` (its pixels per page pixel) instead of the screen's.
 */
export function holdShaders(root: Element, hold: boolean, scale = 0) {
  recordingFull = hold;
  recordingScale = hold ? scale : 0;
  // Copying (older iPhones): the shared canvas grew for the recording — back to its usual
  // size, so it doesn't keep a picture of up to 2048 × 2048 in memory (it grows again if needed).
  const g = shared;
  if (!hold && g && !g.handover && (g.canvas.width > 1024 || g.canvas.height > 1024)) {
    g.canvas.width = MAX_SIDE;
    g.canvas.height = MAX_SIDE;
  }
  for (const p of painters)
    if (root.contains(p.clip)) {
      p.held = hold;
      p.resize();
    }
}

/**
 * A shader effect filling its (positioned) parent. With `bare` it doesn't wrap itself in
 * a `.living-clip` (the caller already has one, as LivingLayer does).
 */
export function ShaderEffect({
  params,
  preview,
  bare,
  behind,
  place,
}: {
  params: ShaderParams;
  preview?: boolean;
  bare?: boolean;
  /** Under the content of a block that doesn't position its children (see `skin-host`). */
  behind?: boolean;
  /** A box and blend of its own (a layer of an own effect, see placeStyle). */
  place?: CSSProperties;
}) {
  const clip = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const painter = useRef<Painter | null>(null);
  const quality = useEffectQuality();
  const unlimited = useUnlimited();
  const key = JSON.stringify(params);

  useEffect(
    () =>
      !bare && clip.current
        ? watchOffscreen(clip.current, !unlimited && (!preview || quality !== 'full'))
        : undefined,
    [quality, preview, unlimited, bare],
  );

  useEffect(() => {
    const el = canvas.current;
    const box = (bare ? el?.closest('.living-clip') : clip.current) as HTMLElement | null;
    if (!el || !box) return;
    const p = new Painter(el, box, JSON.parse(key) as ShaderParams);
    painter.current = p;
    p.resize();
    const ro = new ResizeObserver(() => p.resize());
    ro.observe(el);
    start(p);
    return () => {
      ro.disconnect();
      stop(p);
      painter.current = null;
    };
    // Set up once per canvas; new settings are passed in below without starting again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, bare]);

  useEffect(() => {
    const p = painter.current;
    if (!p) return;
    const next = JSON.parse(key) as ShaderParams;
    const sized = next.kind !== p.params.kind;
    p.setParams(next);
    if (sized) p.resize();
  }, [key]);

  if (quality === 'still') return null;
  const picture = <canvas ref={canvas} className="shader-canvas" />;
  if (bare) return picture;
  return (
    <span
      ref={clip}
      aria-hidden="true"
      className="living-clip living-canvas"
      style={{ ...(behind ? { zIndex: -1 } : {}), ...place }}
    >
      {picture}
    </span>
  );
}
