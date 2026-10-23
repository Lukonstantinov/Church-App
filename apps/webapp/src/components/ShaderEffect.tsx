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
  | 'stripes';

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
};
/** The biggest picture the shared context draws (a side, in pixels). */
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
    density: tune?.density ?? 1,
    weight: tune?.weight ?? 1,
    sharp: tune?.sharp ?? (kind === 'marble' ? 0.45 : 0),
    chaos: tune?.chaos ?? (kind === 'liquid' ? 0.45 : kind === 'marble' ? 0.35 : 0.3),
    seed: tune?.seed ?? 0,
    mode: 0,
    paint: 0,
    glow: tune?.glow ?? 0,
    x: tune?.x ?? (kind === 'fur' ? 0.8 : kind === 'sun' || kind === 'halo' ? 0.72 : 0.5),
    y: tune?.y ?? (kind === 'fur' ? 0.15 : kind === 'sun' || kind === 'halo' ? 0.28 : 0.5),
    drift: tune?.drift ?? false,
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
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_t;
uniform vec3 u_c[4];
uniform float u_n;
uniform float u_strength, u_density, u_weight, u_sharp, u_chaos, u_seed, u_angle, u_size;
uniform float u_mode, u_paint;
uniform float u_glow;
uniform vec2 u_pos;

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
/** A soft line of half-width w round distance d, plus its neon halo. */
vec2 lineGlow(float d, float w) {
  float soft = mix(0.6, 0.12, u_sharp) * w + 0.004;
  float core = 1.0 - smoothstep(w, w + soft, d);
  float halo = exp(-d / (w * 6.0 + 0.01)) * u_glow;
  return vec2(core, halo);
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
  // A wall of motion lines: rows of streaks racing by at their own speeds, heads bright.
  streaks: `
void main() {
  vec2 p = place() / u_size;
  float rows = 14.0 + u_density * 26.0;
  float y = p.y * rows;
  float row = floor(y);
  float speed = 0.25 + hash1(row) * 0.9 + u_chaos * hash1(row + 3.1) * 1.4;
  float dir = hash1(row + 9.7) > 0.5 - u_chaos * 0.5 ? 1.0 : -1.0;
  float len = 0.6 + hash1(row + 1.7) * 1.8;
  float s = p.x * (2.0 / len) + u_t * speed * 0.35 * dir + hash1(row + 4.4) * 10.0;
  float duty = 0.25 + hash1(row + 7.3) * 0.5;
  float f = fract(s);
  float on = step(f, duty);
  float tail = dir > 0.0 ? 1.0 - f / duty : f / duty;
  vec2 lg = lineGlow(abs(fract(y) - 0.5), 0.08 + 0.14 * u_weight);
  float b = on * mix(0.25, 1.0, pow(tail, 1.5));
  vec3 col = palette(hash1(row + 2.2), true);
  float a = clamp((lg.x + lg.y * 0.7) * b, 0.0, 1.0) * u_strength;
  col = col * (1.0 + lg.y * 0.5);
  gl_FragColor = vec4(col * a, a);
}`,
  // Ribbon waves: several smooth lines riding over each other.
  ribbons: `
void main() {
  vec2 p = place() / u_size;
  float t = u_t * 0.25;
  float n = 3.0 + floor(u_density * 4.0);
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float off = (fi / n - 0.5) * 0.9;
    float y = off + 0.12 * sin(p.x * (2.0 + hash1(fi) * 2.0) + t * (0.6 + hash1(fi + 1.0)) + fi)
      + u_chaos * 0.25 * (fbm3(vec2(p.x * 1.3 + t * 0.3, fi * 3.1)) - 0.5);
    vec2 lg = lineGlow(abs(p.y - y), 0.006 + 0.012 * u_weight);
    float k = clamp(lg.x + lg.y * 0.6, 0.0, 1.0);
    col += palette(fi / n, true) * k;
    a = max(a, k);
  }
  a *= u_strength;
  gl_FragColor = vec4(col * u_strength, a);
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
  float edge = mix(0.6, 0.02, u_sharp);
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
  // Falling light: glowing streaks pouring down, bright heads and fading tails.
  lightfall: `
void main() {
  vec2 p = place() / u_size;
  float cols = 26.0 + u_density * 50.0;
  float x = p.x * cols;
  float id = floor(x);
  float h = hash1(id);
  vec2 lg = lineGlow(abs(fract(x) - 0.5), 0.06 + 0.12 * u_weight);
  float speed = 0.5 + h * 1.2 + u_chaos * hash1(id + 2.0) * 1.5;
  float len = 0.4 + hash1(id + 4.0) * 0.9;
  float f = fract(p.y / len + u_t * speed * 0.45 + h * 7.0);
  float part = 0.35 + 0.5 * hash1(id + 6.0);
  float b = f < part ? pow(1.0 - f / part, 1.6) : 0.0;
  vec3 col = palette(hash1(id + 1.0), true);
  float a = clamp((lg.x + lg.y * 0.8) * b, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(col * a * (1.0 + lg.y * 0.5), a);
}`,
  // Rising lines: lines of light sweep in along the floor, bend upward and rise, with
  // pulses of light running up them.
  risers: `
void main() {
  vec2 P = plane() / u_size;
  float aspect = u_res.x / u_res.y;
  float y0 = -0.32;
  float n = 10.0 + floor(u_density * 14.0);
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 26; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float h = hash1(fi);
    float xi = (h * 2.0 - 1.0) * 0.32 * aspect;
    float s = xi < 0.0 ? -1.0 : 1.0;
    float R = 0.06 + abs(xi) * 0.9 + 0.08 * hash1(fi + 1.0);
    vec2 c = vec2(xi + s * R, y0 + R);
    float d;
    float L;
    if (P.y >= c.y) {
      d = abs(P.x - xi);
      L = R * 1.5708 + (P.y - c.y);
    } else if ((P.x - c.x) * s >= 0.0) {
      d = abs(P.y - y0);
      L = -abs(P.x - c.x);
    } else {
      vec2 q = P - c;
      d = abs(length(q) - R);
      L = R * atan(abs(q.x), -q.y);
    }
    float top = 0.05 + 0.45 * hash1(fi + 2.0);
    float fade = 1.0 - smoothstep(top, top + 0.25, P.y);
    vec2 lg = lineGlow(d, 0.002 + 0.004 * u_weight);
    float f = fract(L * (2.0 + u_chaos * 3.0) - u_t * (0.3 + h * 0.5) + h * 9.0);
    float pulse = 0.35 + 0.65 * smoothstep(0.6, 1.0, f);
    float k = clamp(lg.x + lg.y * 0.7, 0.0, 1.0) * fade * pulse;
    col += palette(hash1(fi + 3.0), true) * k;
    a = max(a, k);
  }
  gl_FragColor = vec4(col * u_strength, a * u_strength);
}`,
  // Neon grid: a glowing floor racing toward a bright horizon (synthwave).
  synthgrid: `
void main() {
  vec2 p = plane();
  float hz = 0.05;
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (p.y < hz) {
    float depth = hz - p.y;
    float z = 1.0 / (depth + 0.02);
    float gx = p.x * z * (0.8 + u_density * 0.6);
    float gz = z * (0.35 + u_density * 0.25) + u_t * 0.5;
    float w = 0.02 + 0.04 * u_weight;
    vec2 g1 = lineGlow(0.5 - abs(fract(gx) - 0.5), w);
    vec2 g2 = lineGlow(0.5 - abs(fract(gz) - 0.5), w);
    float k = max(g1.x, g2.x) + (g1.y + g2.y) * 0.5;
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
  float edge = mix(0.5, 0.04, u_sharp);
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
  float f = fract((p.x + p.y * 0.6 + wv) * n - u_t * 0.3);
  float edge = mix(0.2, 0.01, u_sharp);
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
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, COMMON + FRAGMENTS[kind]));
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
};

// ---------- One block ----------

class Painter {
  params: ShaderParams;
  colors: [number, number, number][] = [];
  last = -1;
  held = false;
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
      (p.kind === 'marble' || p.kind === 'sun' || p.kind === 'sunburst' || p.kind === 'halo')
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
    const lite = getQuality() === 'lite' ? 0.75 : 1;
    let k = RES[this.params.kind] * dpr * lite * (recordingFull ? 1 : adapt);
    k = Math.min(k, MAX_SIDE / w, MAX_SIDE / h);
    this.width = Math.max(1, Math.round(w * k));
    this.height = Math.max(1, Math.round(h * k));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
    this.last = -1;
  }

  draw(seconds: number) {
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
    // Hand-over: the off-screen picture is exactly this block's size.
    if (g.handover && (g.canvas.width !== this.width || g.canvas.height !== this.height)) {
      g.canvas.width = this.width;
      g.canvas.height = this.height;
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
    gl.uniform1f(p.loc.u_t!, seconds * q.speed);
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
let slowGap = 1;
let slowTicks = 0;
let easyTicks = 0;
/** Drawing time a tick may take (ms) before it counts as slow: the rest is for the page. */
const BUDGET_MS = 10;

function resizeAll() {
  for (const p of painters) p.resize();
}

function judge(spent: number) {
  if (spent > BUDGET_MS) {
    easyTicks = 0;
    // Two slow ticks in a row (one alone may be a shader being compiled).
    if (++slowTicks < 2) return;
    slowTicks = 0;
    if (adapt > SCALE_MIN) {
      adapt = stepScale(adapt, true);
      resizeAll();
    } else slowGap = Math.min(2.5, slowGap * 1.3);
  } else if (spent < BUDGET_MS * 0.35) {
    slowTicks = 0;
    // About ten seconds of easy drawing before trying more again.
    if (++easyTicks < 240) return;
    easyTicks = 0;
    if (slowGap > 1) slowGap = Math.max(1, slowGap / 1.3);
    else if (adapt < 1) {
      adapt = stepScale(adapt, false);
      resizeAll();
    }
  } else slowTicks = 0;
}

function tick(now: number) {
  frame = 0;
  if (!painters.size) return;
  const lite = getQuality() === 'lite';
  const gap = (1000 / (lite ? 20 : 24)) * slowGap;
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
      if (now - p.last < gap) continue;
      p.last = now;
      p.draw(now / 1000);
      drew = true;
    }
    if (drew) judge(performance.now() - t0);
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
/** Recording: stops (or restarts) their clock while it steps them. */
export function holdShaders(root: Element, hold: boolean) {
  recordingFull = hold;
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
