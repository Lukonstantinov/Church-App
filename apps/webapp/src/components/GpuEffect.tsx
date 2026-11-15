import { useEffect, useRef } from 'react';
import type { MeetingMotion, MotionTune } from '@church/shared';

/**
 * Effects drawn by the graphics chip with PixiJS filters (MIT): the photo under the layer
 * bent by heat haze, a shockwave, a swirl or a lens, its bright parts glowing, a zoom
 * burst, light rays or a water reflection. One WebGL canvas each, loaded only when such an
 * effect is on screen (the library is fetched on first use).
 *
 * - The canvas draws the photo itself (covering the box like the photo under it), so the
 *   effect lines up; without a photo only the light rays have something to show.
 * - Its own clock draws 30 times a second while on screen; a recording steps it through
 *   time instead (seekGpu / holdGpu, like the particle canvases).
 * - Phones allow only so many WebGL canvases: at most MAX_LIVE run at once, and the picker's
 *   small previews show a still stand-in instead of a canvas.
 */

const MAX_LIVE = 6;
let live = 0;

interface Layer {
  draw: (seconds: number) => void;
  held: boolean;
}
const layers = new Map<HTMLCanvasElement, Layer>();

/** Recording: draws the GPU canvases inside `root` as they are `seconds` in. */
export function seekGpu(root: Element, seconds: number) {
  for (const [c, l] of layers) if (root.contains(c)) l.draw(seconds);
}

/** Recording: stops (or restarts) their own clocks while it steps them. */
export function holdGpu(root: Element, hold: boolean) {
  for (const [c, l] of layers) if (root.contains(c)) l.held = hold;
}

/**
 * Our own picture filters (GLSL for PixiJS): an oil painting of the photo, and glitches
 * that break the photo itself. Each gets the time, strength and amount as uniforms.
 */
const PHOTO_HEAD = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uTime;
uniform float uWeight;
uniform float uDensity;
vec4 at(vec2 tc) { return texture(uTexture, clamp(tc, uInputClamp.xy, uInputClamp.zw)); }
/** The point on the picture, 0…1 across and down. */
vec2 screen() { return vTextureCoord * uInputSize.xy / uOutputFrame.zw; }
/** A point 0…1 back to where it is sampled. */
vec2 tex(vec2 s) { return s * uOutputFrame.zw * uInputSize.zw; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float rnd(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
float tr(float x, float n) { return floor(x * n) / n; }
vec2 tr2(vec2 x, vec2 n) { return floor(x * n) / n; }
vec3 rgb2yuv(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(-0.14713, -0.28886, 0.436)), dot(c, vec3(0.615, -0.51499, -0.10001)));
}
vec3 yuv2rgb(vec3 c) {
  return vec3(c.x + 1.13983 * c.z, c.x - 0.39465 * c.y - 0.5806 * c.z, c.x + 2.03211 * c.y);
}
// Ashima Arts' 2D simplex noise (MIT), as in the Bad TV shader.
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

const PHOTO_FRAGMENTS: Partial<Record<MeetingMotion, string>> = {
  // The next four after glitch-core (MIT, github.com/samplemaple/glitch-core; notice in
  // THIRD_PARTY_NOTICES.md), each given movement of its own here.
  // 8-bit: the picture in big pixels, each the nearest colour of a retro palette (amount
  // picks it: Game Boy greens, the 16-colour PICO-8, or few levels per colour like an old
  // home computer), with a light ordered dither
  // that shimmers slowly.
  retro8bit: `
vec3 nearest16(vec3 c) {
  vec3 p[16];
  p[0] = vec3(0.0); p[1] = vec3(0.114, 0.169, 0.325); p[2] = vec3(0.494, 0.145, 0.325);
  p[3] = vec3(0.0, 0.529, 0.318); p[4] = vec3(0.671, 0.322, 0.212); p[5] = vec3(0.373, 0.341, 0.31);
  p[6] = vec3(0.761, 0.765, 0.78); p[7] = vec3(1.0, 0.945, 0.91); p[8] = vec3(1.0, 0.0, 0.302);
  p[9] = vec3(1.0, 0.639, 0.0); p[10] = vec3(1.0, 0.925, 0.153); p[11] = vec3(0.0, 0.894, 0.212);
  p[12] = vec3(0.161, 0.678, 1.0); p[13] = vec3(0.514, 0.463, 0.612); p[14] = vec3(1.0, 0.467, 0.659);
  p[15] = vec3(1.0, 0.8, 0.667);
  vec3 best = p[0];
  float bd = 9.0;
  for (int i = 0; i < 16; i++) {
    vec3 d = c - p[i];
    float e = dot(d * d, vec3(0.3, 0.59, 0.11));
    if (e < bd) { bd = e; best = p[i]; }
  }
  return best;
}
void main() {
  vec2 s = screen();
  vec2 cells = uOutputFrame.zw / (2.0 + 3.0 * uWeight);
  vec2 cell = floor(s * cells);
  vec3 c = at(tex((cell + 0.5) / cells)).rgb;
  float bayer = (mod(cell.x + floor(uTime * 1.5), 2.0) * 2.0 + mod(cell.y, 2.0)) / 4.0 - 0.375;
  // Contrast lifted first: dark photos would otherwise fall to one or two colours.
  c = clamp((c - 0.45) * 1.35 + 0.5 + bayer * 0.08, 0.0, 1.0);
  float p = floor(clamp((uDensity - 0.3) / 2.2, 0.0, 0.999) * 3.0);
  vec3 o;
  if (p < 0.5) {
    float g = floor(clamp(luma(c) * 1.15, 0.0, 0.999) * 4.0) / 3.0;
    o = mix(vec3(0.06, 0.22, 0.06), vec3(0.61, 0.74, 0.06), g);
  } else if (p < 1.5) o = nearest16(c);
  else o = floor(c * 3.999) / 3.0;
  finalColor = vec4(o, 1.0);
}`,
  // Pencil sketch: the picture's lines drawn in graphite on paper, with light hatching in
  // its shadows and a faint paper grain.
  sketch: `
void main() {
  vec2 d = uInputSize.zw * (0.8 + 0.8 * uWeight);
  float tl = luma(at(vTextureCoord + vec2(-d.x, -d.y)).rgb);
  float t = luma(at(vTextureCoord + vec2(0.0, -d.y)).rgb);
  float tr = luma(at(vTextureCoord + vec2(d.x, -d.y)).rgb);
  float l = luma(at(vTextureCoord + vec2(-d.x, 0.0)).rgb);
  float r = luma(at(vTextureCoord + vec2(d.x, 0.0)).rgb);
  float bl = luma(at(vTextureCoord + vec2(-d.x, d.y)).rgb);
  float b = luma(at(vTextureCoord + vec2(0.0, d.y)).rgb);
  float br = luma(at(vTextureCoord + vec2(d.x, d.y)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float edge = clamp(sqrt(gx * gx + gy * gy) * (1.2 + uDensity), 0.0, 1.0);
  float lum = luma(at(vTextureCoord).rgb);
  vec2 px = screen() * uOutputFrame.zw;
  float hatch = step(0.5, fract((px.x + px.y) * 0.18)) * smoothstep(0.55, 0.15, lum) * 0.35;
  float hatch2 = step(0.5, fract((px.x - px.y) * 0.18)) * smoothstep(0.3, 0.05, lum) * 0.3;
  float grain = (noise(px * 0.9) - 0.5) * 0.06;
  float ink = clamp(edge + hatch + hatch2, 0.0, 1.0);
  vec3 paper = vec3(0.97, 0.95, 0.9) + grain;
  finalColor = vec4(mix(paper, vec3(0.16, 0.16, 0.18), ink), 1.0);
}`,
  // Neon edges: the picture's outlines glowing in colours that slowly travel round, over
  // the picture darkened.
  neonedge: `
void main() {
  vec2 d = uInputSize.zw * 1.2;
  float tl = luma(at(vTextureCoord + vec2(-d.x, -d.y)).rgb);
  float t = luma(at(vTextureCoord + vec2(0.0, -d.y)).rgb);
  float tr = luma(at(vTextureCoord + vec2(d.x, -d.y)).rgb);
  float l = luma(at(vTextureCoord + vec2(-d.x, 0.0)).rgb);
  float r = luma(at(vTextureCoord + vec2(d.x, 0.0)).rgb);
  float bl = luma(at(vTextureCoord + vec2(-d.x, d.y)).rgb);
  float b = luma(at(vTextureCoord + vec2(0.0, d.y)).rgb);
  float br = luma(at(vTextureCoord + vec2(d.x, d.y)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  // Only firm outlines glow (fine texture stays dark).
  float edge = smoothstep(0.18, 0.7, sqrt(gx * gx + gy * gy) * (0.8 + 0.5 * uDensity));
  vec2 s = screen();
  float hue = s.x * 0.6 + s.y * 0.4 - uTime * 0.08;
  vec3 neon = 0.5 + 0.5 * cos(6.2831853 * (hue + vec3(0.0, 0.33, 0.67)));
  vec3 base = at(vTextureCoord).rgb * (0.25 - 0.15 * uWeight * 0.5);
  float pulse = 0.85 + 0.15 * sin(uTime * 2.0);
  finalColor = vec4(clamp(base + neon * edge * 1.3 * pulse, 0.0, 1.0), 1.0);
}`,
  // Mirror: the picture folded into a symmetry (amount: left/right, top/bottom, four
  // ways), the fold drifting slowly so it breathes.
  photomirror: `
void main() {
  vec2 s = screen();
  float m = floor(clamp((uDensity - 0.3) / 2.2, 0.0, 0.999) * 3.0);
  float cx = 0.5 + 0.06 * uWeight * sin(uTime * 0.3);
  float cy = 0.5 + 0.06 * uWeight * cos(uTime * 0.23);
  if (m != 1.0) s.x = s.x < cx ? s.x : 2.0 * cx - s.x;
  if (m != 0.0) s.y = s.y < cy ? s.y : 2.0 * cy - s.y;
  finalColor = vec4(at(tex(s)).rgb, 1.0);
}`,
  // Glitches after X-PostProcessing-Library (MIT, github.com/QianMo/X-PostProcessing-Library)
  // and felixturner's Bad TV (MIT); notices in THIRD_PARTY_NOTICES.md. Strength = how hard,
  // amount = how often / how fine. Each comes in bursts and settles, as a real glitch does.
  // Block glitch: blocks of two sizes break off and slide, the colours tearing apart.
  blockglitch: `
void main() {
  vec2 s = screen();
  float t = floor(uTime * (3.0 + 4.0 * uDensity));
  float burst = step(0.4, rnd(vec2(t, 1.0)));
  vec2 bs = vec2(8.0, 16.0) * (0.6 + 0.8 * uDensity);
  float b1 = rnd(floor(s * bs) + t);
  float b2 = rnd(floor(s * bs * vec2(4.0, 2.0)) + t * 1.7);
  // Some blocks break off (big ones, and a few small ones), each by its own amount.
  float hit = max(step(0.86 - 0.08 * uWeight, b1), step(0.93, b2) * 0.7);
  vec2 dir = vec2(rnd(floor(s * bs) + t + 3.1) - 0.5, (rnd(floor(s * bs) + t + 5.3) - 0.5) * 0.25);
  vec2 off = dir * hit * 0.25 * uWeight * burst;
  float split = (0.004 + pow(rnd(vec2(t, 3.0)), 4.0) * 0.03) * uWeight * burst;
  vec3 c = vec3(at(tex(s + off + vec2(split, 0.0))).r, at(tex(s + off)).g, at(tex(s + off - vec2(split, 0.0))).b);
  c = mix(c, c.gbr, step(0.985, b2) * burst);
  finalColor = vec4(c, 1.0);
}`,
  // Line glitch: horizontal bands of uneven width slide sideways with their colour shifted.
  lineglitch: `
void main() {
  vec2 s = screen();
  float T = uTime * (0.5 + 0.5 * cos(uTime * (0.7 + 0.6 * uDensity))) * 2.0;
  float tt = tr(T, 4.0);
  float ut = rnd(tr2(s.yy, vec2(8.0)) + 100.0 * tt);
  float rt = 6.0 * tr(T, 24.0 * ut);
  float bl = 0.5 * rnd(tr2(s.yy + rt, vec2(8.0 * (0.6 + uDensity)))) + 0.5 * rnd(tr2(s.yy + rt, vec2(7.0)));
  bl = bl * 2.0 - 1.0;
  bl = sign(bl) * clamp((abs(bl) - 0.5) / 0.4, 0.0, 1.0) * uWeight;
  vec3 c = at(tex(clamp(s + vec2(0.1 * bl, 0.0), 0.0, 1.0))).rgb;
  vec3 yuv = rgb2yuv(c);
  yuv.y /= 1.0 - 3.0 * abs(bl) * clamp(0.5 - bl, 0.0, 1.0);
  yuv.z += 0.125 * bl * clamp(bl - 0.5, 0.0, 1.0);
  finalColor = vec4(clamp(yuv2rgb(yuv), 0.0, 1.0), 1.0);
}`,
  // Analog noise: grain, colour flicker and now and then a flash to black and white.
  analognoise: `
void main() {
  vec2 s = screen();
  vec3 c = at(vTextureCoord).rgb;
  float t = floor(uTime * 24.0);
  float grain = (rnd(s * vec2(213.0, 117.0) + t * 0.37) - 0.5) * 0.3 * uWeight;
  c += grain;
  c.r += (rnd(vec2(t, 1.0)) - 0.5) * 0.06 * uWeight;
  c.b += (rnd(vec2(t, 2.0)) - 0.5) * 0.06 * uWeight;
  float flash = step(0.9, rnd(vec2(floor(uTime * (3.0 + 5.0 * uDensity)), 3.0)));
  c = mix(c, vec3(luma(c)), flash);
  float line = step(0.996, rnd(vec2(floor(s.y * uOutputFrame.w * 0.5), t))) * 0.5 * uWeight;
  finalColor = vec4(clamp(c + line, 0.0, 1.0), 1.0);
}`,
  // Wave jitter: the picture rippling sideways in waves, red and blue torn apart with it.
  wavejitter: `
void main() {
  vec2 s = screen();
  float strength = 0.5 + 0.5 * cos(uTime * (0.8 + uDensity));
  float y = s.y * uOutputFrame.w;
  float w1 = snoise(vec2(y * 0.01, uTime * 1.6)) * strength * uWeight * 32.0;
  float w2 = snoise(vec2(y * 0.02, uTime * 0.8)) * strength * uWeight * 4.0;
  float dx = w1 * w2 / uOutputFrame.z;
  float split = dx * (0.6 + strength);
  vec2 rb = at(tex(vec2(s.x + dx + split, s.y))).rb;
  float g = at(tex(vec2(s.x + dx, s.y))).g;
  finalColor = vec4(rb.x, g, rb.y, 1.0);
}`,
  // Scan-line jitter: single lines of the picture jumping sideways, in pulses.
  scanjitter: `
void main() {
  vec2 s = screen();
  float strength = 0.5 + 0.5 * cos(uTime * (1.0 + uDensity));
  float row = floor(s.y * uOutputFrame.w / 2.0);
  float j = rnd(vec2(row, floor(uTime * 30.0))) * 2.0 - 1.0;
  j *= step(0.82 - 0.2 * uDensity, abs(j)) * 0.12 * uWeight * strength;
  finalColor = vec4(at(tex(vec2(fract(s.x + j), s.y))).rgb, 1.0);
}`,
  // Tile jitter: every other band of the picture shaking sideways against the next.
  tilejitter: `
void main() {
  vec2 s = screen();
  float n = 8.0 + 24.0 * uDensity;
  float strength = 0.5 + 0.5 * cos(uTime * 1.3);
  float band = step(1.0, mod(s.y * n, 2.0)) * 2.0 - 1.0;
  float dx = band * cos(uTime * 18.0) * 14.0 * uWeight * strength / uOutputFrame.z;
  finalColor = vec4(at(tex(vec2(s.x + dx, s.y))).rgb, 1.0);
}`,
  // RGB split: the three colours drifting apart in sudden jolts, each its own way.
  rgbsplit: `
void main() {
  vec2 s = screen();
  float k = uTime * (2.0 + 3.0 * uDensity);
  vec3 n = vec3(noise(vec2(k, 1.0)), noise(vec2(k + 3.0, 2.0)), noise(vec2(k + 7.0, 3.0)));
  // Always a little apart, now and then jolting far.
  n = (n * 2.0 - 1.0) * (0.15 + 1.5 * pow(abs(n * 2.0 - 1.0), vec3(3.0))) * 0.03 * uWeight;
  float r = at(tex(s + vec2(n.x, -n.y))).r;
  float g = at(tex(s + vec2(n.y, -n.z))).g;
  float b = at(tex(s + vec2(n.z, -n.x))).b;
  finalColor = vec4(r, g, b, 1.0);
}`,
  // Screen jump: the picture now and then rolls up and settles, like a TV losing its hold.
  screenjump: `
void main() {
  vec2 s = screen();
  float slot = floor(uTime * (0.4 + 0.6 * uDensity));
  float ph = fract(uTime * (0.4 + 0.6 * uDensity));
  float on = step(0.3, rnd(vec2(slot, 5.0)));
  float jump = on * pow(1.0 - ph, 2.0) * (0.4 + 0.6 * rnd(vec2(slot, 9.0))) * uWeight;
  float y = fract(s.y + jump);
  vec3 c = at(tex(vec2(s.x, y))).rgb;
  float bar = on * (1.0 - smoothstep(0.0, 0.02, abs(y - 0.999))) * 0.6;
  finalColor = vec4(c * (1.0 - bar), 1.0);
}`,
  // Bad TV: a slow rolling wobble with fine jitter, a drifting colour split, static and
  // scan lines (felixturner's BadTV with its usual companions).
  badtv: `
void main() {
  vec2 p = screen();
  float yt = p.y - uTime * 0.15;
  float off = snoise(vec2(yt * 3.0, 0.0)) * 0.2;
  float dist = 2.5 + 3.5 * uWeight;
  off = off * dist * off * dist * off;
  off += snoise(vec2(yt * 50.0, 0.0)) * (1.0 + uDensity) * 0.001;
  vec2 q = vec2(fract(p.x + off), p.y);
  float sh = 0.003 + 0.004 * uWeight * (0.5 + 0.5 * sin(uTime * 1.3));
  vec3 c = vec3(at(tex(q + vec2(sh, 0.0))).r, at(tex(q)).g, at(tex(q - vec2(sh, 0.0))).b);
  float st = rnd(p * vec2(311.0, 197.0) + floor(uTime * 24.0) * 0.17);
  c = mix(c, vec3(st), 0.08 + 0.06 * uWeight);
  float scan = 0.5 + 0.5 * sin(p.y * uOutputFrame.w * 1.6);
  c *= 0.9 + 0.1 * scan;
  finalColor = vec4(c, 1.0);
}`,
  // Data-mosh: in short bursts, blocks of the picture smear along made-up motion and
  // lose colour depth, as broken video does.
  datamosh: `
void main() {
  vec2 s = screen();
  float slot = floor(uTime * 2.5);
  float phase = fract(uTime * 2.5);
  float burst = step(0.45, hash(vec2(slot, 1.0)));
  float n = 10.0 + 20.0 * uDensity;
  vec2 blk = floor(s * vec2(n, n * uOutputFrame.w / uOutputFrame.z));
  float hit = step(1.0 - 0.45 * uWeight, hash(blk + slot)) * burst;
  vec2 mv = (vec2(hash(blk * 1.7 + slot), hash(blk * 2.3 + slot)) - 0.5) * 0.12 * phase;
  vec2 src = s - mv * hit;
  vec3 c = at(tex(src)).rgb;
  vec3 q = floor(c * 6.0 + 0.5) / 6.0;
  c = mix(c, q, hit * 0.8);
  float bleed = at(tex(src + vec2(0.006 * hit, 0.0))).r;
  c.r = mix(c.r, bleed, hit * 0.6);
  finalColor = vec4(c, at(vTextureCoord).a);
}`,
  // Pixel sort: bright parts of the picture run down in streaks, like sorted pixels.
  pixelsort: `
void main() {
  vec2 s = screen();
  float colId = floor(s.x * uOutputFrame.z / 2.0);
  float len = (0.08 + 0.25 * uWeight) * (0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * 0.7 + hash(vec2(colId, 3.0)) * 6.28)));
  float thr = 0.62 - 0.12 * uDensity;
  vec3 base = at(vTextureCoord).rgb;
  vec3 col = base;
  float bestL = luma(base);
  for (int i = 1; i <= 24; i++) {
    float d = float(i) / 24.0 * len;
    vec3 c = at(tex(s - vec2(0.0, d))).rgb;
    float l = luma(c);
    if (l > thr && l > bestL) {
      float fade = 1.0 - float(i) / 25.0;
      col = mix(col, c, fade);
      bestL = mix(bestL, l, fade);
    }
  }
  finalColor = vec4(col, at(vTextureCoord).a);
}`,
  // Scan shift: horizontal slices of the picture jump sideways in bursts, with the red
  // and blue split apart.
  scanshift: `
void main() {
  vec2 s = screen();
  float slot = floor(uTime * (3.0 + 3.0 * uDensity));
  float burst = step(0.5, hash(vec2(slot, 7.0)));
  float rows = 6.0 + 30.0 * hash(vec2(slot, 2.0));
  float row = floor(s.y * rows);
  float move = (hash(vec2(row, slot)) - 0.5) * 0.16 * uWeight * step(0.55, hash(vec2(row, slot + 4.0))) * burst;
  float split = 0.004 + 0.012 * uWeight * burst;
  vec2 p = s + vec2(move, 0.0);
  float r = at(tex(p + vec2(split, 0.0))).r;
  float g = at(tex(p)).g;
  float b = at(tex(p - vec2(split, 0.0))).b;
  finalColor = vec4(r, g, b, at(vTextureCoord).a);
}`,
  // ----- Special blurs (still: drawn once, like the oil painting) -----
  // Lens blur: the camera out of focus — 32 samples over a disc, bright spots counting
  // more so they open into round bokeh, as a real lens does.
  lensblur: `
void main() {
  vec2 s = screen();
  vec2 px = 1.0 / uOutputFrame.zw;
  float R = 2.0 + 9.0 * uWeight;
  vec3 sum = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    float r = R * sqrt((fi + 0.5) / 32.0);
    float a = fi * 2.39996;
    vec3 c = at(tex(s + vec2(cos(a), sin(a)) * r * px)).rgb;
    float w = 1.0 + (2.0 + 4.0 * uDensity) * pow(luma(c), 3.0);
    sum += c * w;
    ws += w;
  }
  finalColor = vec4(sum / ws, at(vTextureCoord).a);
}`,
  // Spin blur: everything swept round the middle, as a camera turned during the shot.
  spinblur: `
void main() {
  vec2 s = screen();
  vec2 asp = vec2(uOutputFrame.z / uOutputFrame.w, 1.0);
  vec2 d = (s - 0.5) * asp;
  float span = 0.01 + 0.06 * uWeight;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 20; i++) {
    float a = (float(i) / 19.0 - 0.5) * span;
    float c = cos(a), n = sin(a);
    vec2 q = vec2(d.x * c - d.y * n, d.x * n + d.y * c) / asp + 0.5;
    sum += at(tex(q)).rgb;
  }
  finalColor = vec4(sum / 20.0, at(vTextureCoord).a);
}`,
  // Directional blur: smeared along one direction (the "how many" knob turns it), as a
  // fast pan or a speeding car.
  dirblur: `
void main() {
  vec2 s = screen();
  vec2 px = 1.0 / uOutputFrame.zw;
  float ang = clamp((uDensity - 0.3) / 2.2, 0.0, 1.0) * 3.14159;
  vec2 dir = vec2(cos(ang), sin(ang)) * (2.0 + 16.0 * uWeight) * px;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 16; i++) sum += at(tex(s + dir * (float(i) / 15.0 - 0.5))).rgb;
  finalColor = vec4(sum / 16.0, at(vTextureCoord).a);
}`,
  // Tilt-shift: a sharp band across the middle, ever softer above and below it — the
  // picture looks like a tiny model.
  tiltblur: `
void main() {
  vec2 s = screen();
  vec2 px = 1.0 / uOutputFrame.zw;
  float band = 0.06 + 0.1 * clamp(uDensity, 0.0, 2.5);
  float k = smoothstep(band, band + 0.32, abs(s.y - 0.5));
  float R = k * (2.0 + 18.0 * uWeight);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float r = R * sqrt((fi + 0.5) / 24.0);
    float a = fi * 2.39996;
    sum += at(tex(s + vec2(cos(a), sin(a)) * r * px)).rgb;
  }
  vec3 col = sum / 24.0;
  // Miniatures look a little brighter and more colourful.
  col = mix(vec3(luma(col)), col, 1.15);
  finalColor = vec4(col, at(vTextureCoord).a);
}`,
  // Fluted glass: the picture seen through ribbed glass — each rib bends and softens it.
  flutedblur: `
void main() {
  vec2 s = screen();
  vec2 px = 1.0 / uOutputFrame.zw;
  float n = 6.0 + 14.0 * uDensity;
  float f = fract(s.x * n);
  float bend = (f - 0.5) * (0.8 + 1.4 * uWeight) / n;
  vec2 q = vec2(s.x - bend, s.y);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; i++) sum += at(tex(q + vec2((float(i) / 7.0 - 0.5) * (2.0 + 6.0 * uWeight), 0.0) * px)).rgb;
  vec3 col = sum / 8.0;
  // Each rib's rounded face catches a little light on one side and shade on the other.
  col *= 0.88 + 0.24 * sin(f * 3.14159);
  col += 0.06 * pow(1.0 - abs(f - 0.3) * 3.0, 6.0);
  finalColor = vec4(col, at(vTextureCoord).a);
}`,
};

/** Picture filters that don't move: drawn once, again only on a new size or settings. */
const STILL_FILTERS = new Set<MeetingMotion>([
  'lensblur',
  'spinblur',
  'dirblur',
  'tiltblur',
  'flutedblur',
]);

/** PixiJS's own filter vertex step (the picture's coordinates for our fragments). */
const PHOTO_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

/**
 * The oil-painting filter: the anisotropic Kuwahara filter of Kyprianidis et al., after the
 * MIT-licensed Unity version by Eric Xiong (github.com/ericxiong1/AKFUnity6), plus brush
 * bristles. Unlike a plain Kuwahara filter (square patches), its dabs stretch along the
 * picture's own edges and shapes, as a painter's brush follows a form.
 *
 * Both passes read the photo itself (`uImage`, placed by `uImgPos`/`uImgSize` in page
 * pixels) as a small copy (`uSmall`, `uSmallSize` texels) whose texels are about a quarter
 * of a dab: so a dab is the same share of the picture at any screen density, poster size or
 * recording scale, and the 15 × 15 loops phones allow still cover a whole brush stroke
 * without the shimmer that spaced taps on the full photo give.
 *  1. Flow: the structure tensor (from central differences) gathered over 7 × 7 small
 *     texels, turned into a direction and how strongly it holds (0 … 1).
 *  2. Paint: eight overlapping sectors of an ellipse along that direction are averaged, the
 *     calmest counting most; then bristle streaks are combed along the direction, lit from
 *     the top left as thick paint, fading out where the direction is unsure (flat sky, sea).
 */
const OIL_HEAD = `
uniform sampler2D uSmall;
uniform vec2 uSmallSize;
uniform vec2 uImgPos;
uniform vec2 uImgSize;
uniform float uTap;
/** Where this pixel is on the photo, 0…1 (the frame's place on the page + its own place). */
vec2 photoUv() { return (uOutputFrame.xy + screen() * uOutputFrame.zw - uImgPos) / uImgSize; }
vec4 small(vec2 uv) { return texture(uSmall, clamp(uv, 0.0, 1.0)); }
`;
const OIL_FLOW = `
void main() {
  vec2 uv = photoUv();
  vec2 d = 1.0 / uSmallSize;
  vec3 g = vec3(0.0);
  float ws = 0.0;
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      vec2 o = vec2(float(i), float(j)) * 1.6 * uTap;
      float w = exp(-float(i * i + j * j) / 6.0);
      vec2 p = uv + o * d;
      vec3 sx = small(p + vec2(d.x, 0.0)).rgb - small(p - vec2(d.x, 0.0)).rgb;
      vec3 sy = small(p + vec2(0.0, d.y)).rgb - small(p - vec2(0.0, d.y)).rgb;
      g += vec3(dot(sx, sx), dot(sy, sy), dot(sx, sy)) * w;
      ws += w;
    }
  }
  g /= ws;
  float root = sqrt(max(0.0, (g.x - g.y) * (g.x - g.y) + 4.0 * g.z * g.z));
  float l1 = 0.5 * (g.x + g.y + root);
  float l2 = 0.5 * (g.x + g.y - root);
  vec2 v = vec2(l1 - g.x, -g.z);
  vec2 t = length(v) > 1e-7 ? normalize(v) : vec2(0.0, 1.0);
  float A = l1 + l2 > 1e-6 ? (l1 - l2) / (l1 + l2) : 0.0;
  finalColor = vec4(t * 0.5 + 0.5, A, 1.0);
}`;
const OIL_PAINT = `
uniform sampler2D uImage;
void main() {
  vec2 uv = photoUv();
  vec2 d = 1.0 / uSmallSize;
  vec4 tf = at(vTextureCoord);
  float A = tf.z;
  // Where the picture has no firm direction (flat sea, sky) the brush keeps one steady slant.
  vec2 t = tf.xy * 2.0 - 1.0;
  t *= sign(dot(t, vec2(0.8, 0.6)) + 1e-4);
  t = normalize(mix(vec2(0.8, 0.6), t, smoothstep(0.02, 0.25, A)) + 1e-5);
  // The dab: up to 7 small texels long along the form, narrower across it.
  float radius = 3.6;
  float a = radius * clamp(1.0 + A, 0.1, 2.0);
  float b = radius * clamp(1.0 / (1.0 + A), 0.1, 2.0);
  float phi = -atan(t.y, t.x);
  float cp = cos(phi), sp = sin(phi);
  // GLSL fills a matrix by columns: this is the rotation [cos -sin; sin cos].
  mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, sp, -sp, cp);
  float maxX = sqrt(a * a * cp * cp + b * b * sp * sp);
  float maxY = sqrt(a * a * sp * sp + b * b * cp * cp);
  float zeta = 2.0 / radius;
  float zc = 0.58;
  float eta = (zeta + cos(zc)) / (sin(zc) * sin(zc));
  vec4 m[8];
  vec3 s[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
  for (int j = -7; j <= 7; j++) {
    float y = float(j);
    if (abs(y) > maxY) continue;
    for (int i = -7; i <= 7; i++) {
      float x = float(i);
      if (abs(x) > maxX) continue;
      vec2 v = SR * vec2(x, y);
      if (dot(v, v) > 0.25) continue;
      vec3 c = clamp(small(uv + vec2(x, y) * uTap * d).rgb, 0.0, 1.0);
      float w[8];
      float sum = 0.0;
      float vxx = zeta - eta * v.x * v.x;
      float vyy = zeta - eta * v.y * v.y;
      float z = max(0.0, v.y + vxx); w[0] = z * z; sum += w[0];
      z = max(0.0, -v.x + vyy); w[2] = z * z; sum += w[2];
      z = max(0.0, -v.y + vxx); w[4] = z * z; sum += w[4];
      z = max(0.0, v.x + vyy); w[6] = z * z; sum += w[6];
      vec2 u = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
      vxx = zeta - eta * u.x * u.x;
      vyy = zeta - eta * u.y * u.y;
      z = max(0.0, u.y + vxx); w[1] = z * z; sum += w[1];
      z = max(0.0, -u.x + vyy); w[3] = z * z; sum += w[3];
      z = max(0.0, -u.y + vxx); w[5] = z * z; sum += w[5];
      z = max(0.0, u.x + vyy); w[7] = z * z; sum += w[7];
      float g = exp(-3.125 * dot(u, u)) / max(sum, 1e-5);
      for (int k = 0; k < 8; k++) {
        float wk = w[k] * g;
        m[k] += vec4(c * wk, wk);
        s[k] += c * c * wk;
      }
    }
  }
  vec4 outc = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    if (m[k].w <= 0.0) continue;
    vec3 mean = m[k].rgb / m[k].w;
    vec3 var = abs(s[k] / m[k].w - mean * mean);
    float w = 1.0 / (1.0 + pow(20000.0 * (var.r + var.g + var.b), 4.0));
    outc += vec4(mean * w, w);
  }
  vec3 col = outc.w > 0.0 ? outc.rgb / outc.w : small(uv).rgb;

  // The stroke's own colour streak (Photoshop's "cleanliness"): the photo's colours dragged
  // along the direction, so each dab reads as one pull of a loaded brush.
  vec3 drag = vec3(0.0);
  for (int i = -4; i <= 4; i++) drag += small(uv + t * float(i) * 1.5 * uTap * d).rgb;
  drag /= 9.0;
  float firm = smoothstep(0.03, 0.35, A);
  col = mix(col, drag, 0.35 * firm);

  // Bristles (Photoshop's "bristle detail" and "shine"): fine grain smeared along the
  // stroke direction (line integral convolution, as G'MIC's painting filters do), which
  // combs it into hairs ~1.5 px apart and ~25 px long; three such smears side by side give
  // the slope, lit from the top left as thick paint. In page pixels of the picture as
  // shown, so they read on a phone; softer where the direction is unsure.
  vec2 p = uv * uImgSize;
  vec2 n = vec2(-t.y, t.x);
  float h0 = 0.0, ha = 0.0, hb = 0.0;
  for (int i = -6; i <= 6; i++) {
    vec2 q = p + t * float(i) * 2.0;
    h0 += noise(q * 0.7);
    ha += noise((q + n * 0.8) * 0.7);
    hb += noise((q - n * 0.8) * 0.7);
  }
  h0 = (h0 / 13.0 - 0.5) * 3.0;
  ha = (ha / 13.0 - 0.5) * 3.0;
  hb = (hb / 13.0 - 0.5) * 3.0;
  // Separate strokes, some loaded with more paint than others.
  float load = noise(p * 0.07 + 11.0);
  float k = (0.5 + 0.4 * uDensity) * (0.4 + 0.6 * firm) * (0.6 + 0.6 * load);
  vec2 light = normalize(vec2(-0.6, -0.8));
  float lit = (ha - hb) / 1.6 * dot(n, light);
  col *= 1.0 + k * h0 * 0.16;
  col += k * lit * 0.26;
  col += k * pow(max(0.0, lit), 2.0) * 0.2;
  // Paint a little richer than the photo, on a faint canvas weave.
  vec2 px = uv * uImgSize;
  float weave = sin(px.x * 1.9) * sin(px.y * 1.9);
  col = (col - 0.5) * 1.06 + 0.5;
  col = mix(vec3(luma(col)), col, 1.15) * (0.98 + 0.02 * weave);
  float alpha = texture(uImage, clamp(uv, 0.0, 1.0)).a;
  finalColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}`;

const STAND_IN: Partial<Record<MeetingMotion, string>> = {
  oilfilter: '🎨',
  retro8bit: '👾',
  sketch: '✏️',
  neonedge: '💡',
  photomirror: '🪞',
  blockglitch: '🧱',
  lineglitch: '📶',
  analognoise: '📻',
  wavejitter: '〰️',
  scanjitter: '📉',
  tilejitter: '🎞',
  rgbsplit: '🔴',
  screenjump: '⏫',
  badtv: '📺',
  datamosh: '📼',
  pixelsort: '🌈',
  scanshift: '📺',
  lensblur: '📷',
  spinblur: '🌀',
  dirblur: '💨',
  tiltblur: '🔍',
  flutedblur: '🪟',
  heatwave: '🌫',
  shockwave: '💥',
  bloom: '✨',
  zoomburst: '🚀',
  swirl: '🌀',
  bulge: '🔍',
  godrays: '☀️',
  reflection: '🌊',
};

/** Effects that bend or light the photo: nothing to show without one. */
const NEEDS_PHOTO = new Set<MeetingMotion>([
  'oilfilter',
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
  'datamosh',
  'pixelsort',
  'scanshift',
  'lensblur',
  'spinblur',
  'dirblur',
  'tiltblur',
  'flutedblur',
  'heatwave',
  'shockwave',
  'bloom',
  'zoomburst',
  'swirl',
  'bulge',
  'reflection',
]);

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

/** A soft noise picture that tiles, for the heat haze to bend the photo by. */
function noiseCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(128, 128);
  // A few smooth waves added up: no hard specks, and the edges meet when tiled.
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const a = (x / 128) * Math.PI * 2;
      const b = (y / 128) * Math.PI * 2;
      const r = 0.5 + 0.25 * Math.sin(a * 2 + Math.sin(b * 3)) + 0.25 * Math.sin(b * 2 + a);
      const g = 0.5 + 0.25 * Math.cos(b * 3 + Math.sin(a * 2)) + 0.25 * Math.cos(a * 3 - b);
      const i = (y * 128 + x) * 4;
      img.data[i] = Math.round(r * 255);
      img.data[i + 1] = Math.round(g * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function GpuEffect({
  kind,
  tune,
  image,
  preview,
}: {
  kind: MeetingMotion;
  tune?: MotionTune | null;
  image?: string | null;
  preview?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const blank = NEEDS_PHOTO.has(kind) && !image;
  // The settings are read on every drawing: moving a slider changes the running effect
  // instead of throwing its WebGL canvas away and making a new one for every step (phones
  // handle that churn badly — it was one of the causes of lag while editing).
  const settings = useRef({
    weight: 1,
    density: 1,
    color: null as string | null,
    angle: 0,
    speed: 1,
  });
  useEffect(() => {
    settings.current = {
      weight: tune?.weight ?? 1,
      density: tune?.density ?? 1,
      color: tune?.color ?? null,
      angle: tune?.angle ?? 0,
      speed: tune?.speed ?? 1,
    };
  }, [tune?.weight, tune?.density, tune?.color, tune?.angle, tune?.speed]);

  useEffect(() => {
    const el = ref.current;
    if (!el || preview || blank || live >= MAX_LIVE) return;
    live++;
    let stopped = false;
    let frame = 0;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const PIXI = await import('pixi.js');
      const F = await import('pixi-filters');
      const box = el.parentElement;
      if (stopped || !box) return;
      const app = new PIXI.Application();
      await app.init({
        canvas: el,
        width: Math.max(1, box.clientWidth),
        height: Math.max(1, box.clientHeight),
        backgroundAlpha: 0,
        antialias: false,
        // The recorder copies the canvas between frames.
        preserveDrawingBuffer: true,
        autoStart: false,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: false,
        preference: 'webgl',
      });
      const photo = image ? await loadImage(image).catch(() => null) : null;
      if (stopped) {
        app.destroy({ removeView: false }, { children: true, texture: true });
        return;
      }
      const stage = new PIXI.Container();
      app.stage.addChild(stage);
      let sprite: InstanceType<typeof PIXI.Sprite> | null = null;
      if (photo) {
        sprite = new PIXI.Sprite(PIXI.Texture.from(photo));
        stage.addChild(sprite);
      } else {
        // Light rays need something to light: black, mixed in as light (`screen`).
        const g = new PIXI.Graphics().rect(0, 0, 4000, 4000).fill(0x000000);
        stage.addChild(g);
      }

      // The photo covers the box as the photo under it does (centred).
      const layout = () => {
        const W = box.clientWidth || 1;
        const H = box.clientHeight || 1;
        app.renderer.resize(W, H);
        if (sprite && photo) {
          const k = Math.max(W / photo.naturalWidth, H / photo.naturalHeight);
          sprite.scale.set(k);
          sprite.position.set((W - photo.naturalWidth * k) / 2, (H - photo.naturalHeight * k) / 2);
        }
        return { W, H };
      };
      let { W, H } = layout();

      let noise: InstanceType<typeof PIXI.Sprite> | null = null;
      const { weight, density, angle } = settings.current;
      const own = PHOTO_FRAGMENTS[kind];
      // The oil painting: two passes (the brush directions, then the paint), both reading a
      // small copy of the photo whose texels are a set share of the picture (see OIL_HEAD).
      const oilUniforms = new PIXI.UniformGroup({
        uImgPos: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
        uImgSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uSmallSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uTap: { value: 1.6, type: 'f32' },
        uTime: { value: 0, type: 'f32' },
        uWeight: { value: weight, type: 'f32' },
        uDensity: { value: density, type: 'f32' },
      });
      // The copy, one texel to a page pixel of the picture as shown: the paint pass spaces its
      // taps by the brush size (`uTap`), so a dab is 15-35 pixels long on screen, as a stroke
      // looks in Photoshop's Oil Paint at its usual scale, whatever the photo's own size.
      let smallFor = '';
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = smallCanvas.height = 2;
      const smallSource = new PIXI.CanvasSource({ resource: smallCanvas, scaleMode: 'linear' });
      const makeSmall = (brush: number) => {
        if (!photo || !sprite) return;
        const texel = 1;
        const key = `${brush}|${Math.round(sprite.width)}x${Math.round(sprite.height)}`;
        if (key === smallFor) return;
        smallFor = key;
        const w = Math.max(8, Math.min(photo.naturalWidth, Math.round(sprite.width / texel)));
        const h = Math.max(8, Math.min(photo.naturalHeight, Math.round(sprite.height / texel)));
        // Halve in steps: one big jump down skips pixels and the copy shimmers.
        let from: CanvasImageSource = photo;
        let fw = photo.naturalWidth;
        let fh = photo.naturalHeight;
        while (fw / 2 > w && fh / 2 > h) {
          const step = document.createElement('canvas');
          step.width = Math.round(fw / 2);
          step.height = Math.round(fh / 2);
          const c = step.getContext('2d')!;
          c.imageSmoothingQuality = 'high';
          c.drawImage(from, 0, 0, step.width, step.height);
          from = step;
          fw = step.width;
          fh = step.height;
        }
        smallSource.resize(w, h, 1);
        const c = smallCanvas.getContext('2d')!;
        c.clearRect(0, 0, w, h);
        c.imageSmoothingQuality = 'high';
        c.drawImage(from, 0, 0, w, h);
        smallSource.update();
        const size = oilUniforms.uniforms.uSmallSize as Float32Array;
        size[0] = w;
        size[1] = h;
      };
      const akf =
        kind === 'oilfilter' && sprite
          ? (() => {
              makeSmall(weight);
              const pass = (name: string, fragment: string) =>
                new PIXI.Filter({
                  glProgram: PIXI.GlProgram.from({
                    vertex: PHOTO_VERTEX,
                    fragment: PHOTO_HEAD + OIL_HEAD + fragment,
                    name: `oil-${name}`,
                  }),
                  resources: {
                    photoUniforms: oilUniforms,
                    uSmall: smallSource,
                    uSmallSampler: smallSource.style,
                    uImage: sprite.texture.source,
                    uImageSampler: sprite.texture.source.style,
                  },
                });
              return [pass('flow', OIL_FLOW), pass('paint', OIL_PAINT)];
            })()
          : null;
      const filter = (() => {
        if (akf) return akf[akf.length - 1]!;
        if (own)
          return new PIXI.Filter({
            glProgram: PIXI.GlProgram.from({
              vertex: PHOTO_VERTEX,
              fragment: PHOTO_HEAD + own,
              name: `photo-${kind}`,
            }),
            resources: {
              photoUniforms: {
                uTime: { value: 0, type: 'f32' },
                uWeight: { value: weight, type: 'f32' },
                uDensity: { value: density, type: 'f32' },
              },
            },
          });
        switch (kind) {
          case 'heatwave': {
            const tex = PIXI.Texture.from(noiseCanvas());
            tex.source.addressMode = 'repeat';
            noise = new PIXI.Sprite(tex);
            // Big, slow ripples like air over hot ground (not a wobble).
            noise.scale.set(4);
            noise.renderable = false;
            app.stage.addChild(noise);
            return new PIXI.DisplacementFilter({ sprite: noise, scale: 6 * weight });
          }
          case 'shockwave':
            return new F.ShockwaveFilter({
              center: { x: W / 2, y: H / 2 },
              amplitude: 16 * weight,
              wavelength: 140,
              speed: 380,
              brightness: 1.15,
              radius: -1,
            });
          case 'bloom':
            return new F.AdvancedBloomFilter({ threshold: 0.62, bloomScale: 0.4, blur: 8 });
          case 'zoomburst':
            return new F.ZoomBlurFilter({
              center: { x: W / 2, y: H / 2 },
              innerRadius: Math.min(W, H) * 0.12,
              strength: 0,
            });
          case 'swirl':
            return new F.TwistFilter({
              offset: { x: W / 2, y: H / 2 },
              radius: Math.min(W, H) * 0.48,
              angle: 0,
              padding: 0,
            });
          case 'bulge':
            return new F.BulgePinchFilter({
              center: { x: 0.5, y: 0.5 },
              radius: Math.min(W, H) * 0.42,
              strength: 0,
            });
          case 'godrays':
            return new F.GodrayFilter({
              angle: 30 + angle,
              gain: 0.45 + 0.1 * density,
              lacunarity: 2.6,
              parallel: true,
              alpha: 0.85,
            });
          case 'reflection':
            return new F.ReflectionFilter({
              mirror: true,
              boundary: 0.66,
              amplitude: [0, 18 * weight],
              waveLength: [30, 110],
              alpha: [1, 1],
            });
          default:
            return null;
        }
      })();
      if (akf) stage.filters = akf;
      else if (filter) stage.filters = [filter];
      // Where the photo is on the page, for the painting pass (it reads the photo itself).
      const placePhoto = () => {
        if (!akf || !sprite) return;
        const u = oilUniforms.uniforms as { uImgPos: Float32Array; uImgSize: Float32Array };
        u.uImgPos[0] = sprite.x;
        u.uImgPos[1] = sprite.y;
        u.uImgSize[0] = sprite.width;
        u.uImgSize[1] = sprite.height;
      };
      placePhoto();
      // A painting stands still: drawn once, then again only when its size or settings change.
      let painted = '';

      // One moment of the effect (seconds since its start, at its speed).
      const draw = (seconds: number) => {
        const { weight, density, color, angle, speed } = settings.current;
        if (kind === 'godrays') stage.tint = color ?? 0xffffff;
        const t = seconds * speed;
        const wave = 0.5 + 0.5 * Math.sin(t * 1.6);
        if (akf) {
          makeSmall(weight);
          oilUniforms.uniforms.uTap = 0.7 + 0.55 * Math.max(0.2, weight);
          oilUniforms.uniforms.uWeight = weight;
          oilUniforms.uniforms.uDensity = density;
        } else if (own && filter) {
          const u = (filter.resources as { photoUniforms: { uniforms: Record<string, number> } })
            .photoUniforms.uniforms;
          u.uTime = t;
          u.uWeight = weight;
          u.uDensity = density;
        }
        if (filter instanceof PIXI.DisplacementFilter && noise) {
          noise.position.set(t * 30, t * 18);
          filter.scale.x = filter.scale.y = 6 * weight;
        } else if (filter instanceof F.ShockwaveFilter) {
          filter.amplitude = 16 * weight;
          filter.time = t % 2.6;
        } else if (filter instanceof F.AdvancedBloomFilter) {
          // Only the brightest parts glow, breathing gently.
          filter.bloomScale = 0.2 + 0.55 * weight * wave;
        } else if (filter instanceof F.ZoomBlurFilter) {
          filter.strength = 0.14 * weight * Math.pow(wave, 3);
        } else if (filter instanceof F.TwistFilter) {
          filter.angle = 2.2 * weight * Math.sin(t * 0.7);
        } else if (filter instanceof F.BulgePinchFilter) {
          filter.strength = 0.55 * Math.max(-1, Math.min(1, weight * Math.sin(t * 1.1)));
        } else if (filter instanceof F.GodrayFilter) {
          filter.angle = 30 + angle;
          filter.gain = 0.45 + 0.1 * density;
          filter.time = t * 0.6;
        } else if (filter instanceof F.ReflectionFilter) {
          filter.amplitude = [0, 18 * weight];
          filter.time = t * 1.4;
        }
        app.render();
      };
      const entry: Layer = { draw, held: false };
      layers.set(el, entry);

      const resize = new ResizeObserver(() => {
        ({ W, H } = layout());
        placePhoto();
        painted = '';
        if (filter instanceof F.ShockwaveFilter || filter instanceof F.ZoomBlurFilter)
          filter.center = { x: W / 2, y: H / 2 };
        if (filter instanceof F.TwistFilter) {
          filter.offset = { x: W / 2, y: H / 2 };
          filter.radius = Math.min(W, H) * 0.48;
        }
        if (filter instanceof F.BulgePinchFilter) filter.radius = Math.min(W, H) * 0.42;
      });
      resize.observe(box);

      // Its own clock: 30 drawings a second, none while off screen or hidden.
      const start = performance.now();
      let last = 0;
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        if (entry.held || now - last < 33 || document.hidden || el.closest('[data-off]')) return;
        last = now;
        if (akf || STILL_FILTERS.has(kind)) {
          const key = `${W}x${H}|${settings.current.weight}|${settings.current.density}`;
          if (key === painted) return;
          painted = key;
        }
        draw((now - start) / 1000);
      };
      frame = requestAnimationFrame(tick);

      cleanup = () => {
        resize.disconnect();
        layers.delete(el);
        // Give the WebGL canvas back at once (phones allow only a few).
        const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
        app.destroy({ removeView: false }, { children: true, texture: true, textureSource: true });
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      };
      if (stopped) cleanup();
    })().catch(() => {
      // No WebGL here: the effect is simply left out.
    });

    return () => {
      stopped = true;
      live--;
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [kind, image, preview, blank]);

  if (preview)
    return (
      <span className="gpu-stand-in" aria-hidden="true">
        {STAND_IN[kind]}
      </span>
    );
  if (blank) return null;
  // A new canvas for each set-up: a WebGL canvas can't start again once given back.
  return <canvas key={`${kind}|${image}`} ref={ref} className="gpu-canvas" />;
}
