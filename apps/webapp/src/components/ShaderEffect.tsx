import { useEffect, useRef } from 'react';
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

export type ShaderKind = 'silk' | 'mesh' | 'liquid' | 'marble' | 'fill';

/** How much of the screen's pixels each kind is drawn at (they're all soft). */
const RES: Record<ShaderKind, number> = {
  liquid: 0.4,
  mesh: 0.25,
  silk: 0.5,
  marble: 1,
  fill: 0.25,
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
  canvas: HTMLCanvasElement;
  programs: Partial<
    Record<ShaderKind, { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> }>
  >;
}
let shared: Gl | null = null;
let broken = false;

function context(): Gl | null {
  if (shared || broken) return shared;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = MAX_SIDE;
    canvas.height = MAX_SIDE;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    if (!gl) {
      broken = true;
      return null;
    }
    // The phone may take the context back (memory, background): start again next frame.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      shared = null;
    });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    shared = { gl, canvas, programs: {} };
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
];

function program(g: Gl, kind: ShaderKind) {
  const have = g.programs[kind];
  if (have) return have;
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
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, COMMON + FRAGMENTS[kind]));
  gl.bindAttribLocation(prog, 0, 'a');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
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

// ---------- One block ----------

class Painter {
  params: ShaderParams;
  colors: [number, number, number][] = [];
  last = -1;
  held = false;
  private ctx: CanvasRenderingContext2D | null;
  width = 0;
  height = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly clip: HTMLElement,
    params: ShaderParams,
  ) {
    this.ctx = canvas.getContext('2d');
    this.params = params;
    this.setParams(params);
  }

  setParams(p: ShaderParams) {
    this.params = p;
    const list = p.colors.map(parseColor).filter((c): c is [number, number, number] => !!c);
    this.colors = list.length
      ? list
      : p.kind === 'marble'
        ? MARBLE.map((c) => parseColor(c)!)
        : ownColors(this.clip);
    // Marble always needs four (base, cloud, veins, accent): the rest from its own set.
    if (p.kind === 'marble')
      while (this.colors.length < 4) this.colors.push(parseColor(MARBLE[this.colors.length]!)!);
    this.last = -1;
  }

  resize() {
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const lite = getQuality() === 'lite' ? 0.75 : 1;
    let k = RES[this.params.kind] * dpr * lite;
    k = Math.min(k, MAX_SIDE / w, MAX_SIDE / h);
    this.width = Math.max(1, Math.round(w * k));
    this.height = Math.max(1, Math.round(h * k));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
    this.last = -1;
  }

  draw(seconds: number) {
    if (!this.ctx) return;
    if (!this.width) this.resize();
    if (!this.width) return;
    const g = context();
    if (!g) return;
    const { gl } = g;
    if (gl.isContextLost()) return;
    let p;
    try {
      p = program(g, this.params.kind);
    } catch {
      return;
    }
    const q = this.params;
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
    gl.uniform1f(p.loc.u_mode!, q.mode);
    // Silk: a whole cloth when it has colours of its own.
    gl.uniform1f(p.loc.u_paint!, q.kind === 'silk' ? (q.colors.length ? 1 : 0) : q.paint);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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

function tick(now: number) {
  frame = 0;
  if (!painters.size) return;
  const lite = getQuality() === 'lite';
  const gap = 1000 / (lite ? 20 : 24);
  const html = document.documentElement;
  if (!document.hidden && !(lite && html.dataset.scrolling)) {
    const still = standing();
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
    }
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
  for (const p of painters) if (root.contains(p.clip)) p.held = hold;
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
}: {
  params: ShaderParams;
  preview?: boolean;
  bare?: boolean;
  /** Under the content of a block that doesn't position its children (see `skin-host`). */
  behind?: boolean;
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
      style={behind ? { zIndex: -1 } : undefined}
    >
      {picture}
    </span>
  );
}
