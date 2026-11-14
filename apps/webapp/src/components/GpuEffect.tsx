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
`;

const PHOTO_FRAGMENTS: Partial<Record<MeetingMotion, string>> = {
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
};

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
 * MIT-licensed Unity version by Eric Xiong (github.com/ericxiong1/AKFUnity6). Unlike a plain
 * Kuwahara filter (square patches), its dabs stretch along the picture's own edges and
 * shapes, as a painter's brush follows a form. Four passes: the edges' directions (a
 * structure tensor from Sobel), blurred across and down, turned into a direction and how
 * strongly it holds; then each pixel averages eight overlapping sectors of an ellipse along
 * that direction, the calmest ones counting most. The in-between pictures are 8-bit, so
 * the tensor is kept square-root encoded (small edges keep their detail).
 */
const AKF_CODEC = `
vec3 enc(vec3 g) {
  return vec3(sqrt(clamp(g.x / 3.0, 0.0, 1.0)), sqrt(clamp(g.y / 3.0, 0.0, 1.0)),
    0.5 + 0.5 * sign(g.z) * sqrt(clamp(abs(g.z) / 3.0, 0.0, 1.0)));
}
vec3 dec(vec3 e) {
  float f = (e.z - 0.5) * 2.0;
  return vec3(e.x * e.x * 3.0, e.y * e.y * 3.0, sign(f) * f * f * 3.0);
}
`;
const AKF_TENSOR = `
void main() {
  vec2 d = uInputSize.zw;
  vec3 a = at(vTextureCoord + vec2(-d.x, -d.y)).rgb;
  vec3 b = at(vTextureCoord + vec2(0.0, -d.y)).rgb;
  vec3 c = at(vTextureCoord + vec2(d.x, -d.y)).rgb;
  vec3 l = at(vTextureCoord + vec2(-d.x, 0.0)).rgb;
  vec3 r = at(vTextureCoord + vec2(d.x, 0.0)).rgb;
  vec3 f = at(vTextureCoord + vec2(-d.x, d.y)).rgb;
  vec3 g = at(vTextureCoord + vec2(0.0, d.y)).rgb;
  vec3 h = at(vTextureCoord + vec2(d.x, d.y)).rgb;
  vec3 sx = (a + 2.0 * l + f - c - 2.0 * r - h) / 4.0;
  vec3 sy = (a + 2.0 * b + c - f - 2.0 * g - h) / 4.0;
  finalColor = vec4(enc(vec3(dot(sx, sx), dot(sy, sy), dot(sx, sy))), 1.0);
}`;
/** The tensor blurred one way (`uDir`): a Gaussian of 11 taps. */
const AKF_BLUR = `
uniform vec2 uDir;
void main() {
  vec3 sum = vec3(0.0);
  float ws = 0.0;
  for (int i = -5; i <= 5; i++) {
    float x = float(i);
    float w = exp(-x * x / 8.0);
    sum += dec(at(vTextureCoord + uDir * x * uInputSize.zw).rgb) * w;
    ws += w;
  }
  finalColor = vec4(enc(sum / ws), 1.0);
}`;
/** The blurred tensor as a direction (packed) and how strongly it holds (0 … 1). */
const AKF_EIGEN = `
void main() {
  vec3 g = dec(at(vTextureCoord).rgb);
  float root = sqrt(g.y * g.y - 2.0 * g.x * g.y + g.x * g.x + 4.0 * g.z * g.z);
  float l1 = 0.5 * (g.y + g.x + root);
  float l2 = 0.5 * (g.y + g.x - root);
  vec2 v = vec2(l1 - g.x, -g.z);
  vec2 t = length(v) > 0.0 ? normalize(v) : vec2(0.0, 1.0);
  float A = l1 + l2 > 0.0 ? (l1 - l2) / (l1 + l2) : 0.0;
  finalColor = vec4(t * 0.5 + 0.5, A, 1.0);
}`;
/**
 * The painting itself: the photo (`uImage`, placed by `uImgPos`/`uImgSize` in page pixels)
 * averaged over eight sectors of an ellipse turned along the direction (`uTexture`).
 */
const AKF_PAINT = `
uniform sampler2D uImage;
uniform vec2 uImgPos;
uniform vec2 uImgSize;
uniform float uRes;
vec3 photo(vec2 page) { return texture(uImage, clamp((page - uImgPos) / uImgSize, 0.0, 1.0)).rgb; }
void main() {
  vec4 tf = at(vTextureCoord);
  vec2 t = tf.xy * 2.0 - 1.0;
  float A = tf.z;
  float radius = 1.8 + 2.6 * uWeight;
  float alpha = 1.0;
  float a = radius * clamp((alpha + A) / alpha, 0.1, 2.0);
  float b = radius * clamp(alpha / (alpha + A), 0.1, 2.0);
  float phi = -atan(t.y, t.x);
  float cp = cos(phi), sp = sin(phi);
  mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, -sp, sp, cp);
  float maxX = sqrt(a * a * cp * cp + b * b * sp * sp);
  float maxY = sqrt(a * a * sp * sp + b * b * cp * cp);
  float zeta = 2.0 / radius;
  float zc = 0.58;
  float eta = (zeta + cos(zc)) / (sin(zc) * sin(zc));
  vec4 m[8];
  vec3 s[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
  // Where this pixel is on the page (frame origin + its place), in page pixels.
  vec2 here = (vTextureCoord * uInputSize.xy + uOutputFrame.xy) / uRes;
  for (int j = -10; j <= 10; j++) {
    float y = float(j);
    if (abs(y) > maxY) continue;
    for (int i = -10; i <= 10; i++) {
      float x = float(i);
      if (abs(x) > maxX) continue;
      vec2 v = SR * vec2(x, y);
      if (dot(v, v) > 0.25) continue;
      vec3 c = clamp(photo(here + vec2(x, y) / uRes), 0.0, 1.0);
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
  float hard = 14.0 * (0.6 + 0.8 * uDensity);
  for (int k = 0; k < 8; k++) {
    if (m[k].w <= 0.0) continue;
    vec3 mean = m[k].rgb / m[k].w;
    vec3 var = abs(s[k] / m[k].w - mean * mean);
    float w = 1.0 / (1.0 + pow(hard * 1000.0 * (var.r + var.g + var.b), 4.0));
    outc += vec4(mean * w, w);
  }
  vec3 col = outc.w > 0.0 ? outc.rgb / outc.w : photo(here);
  // A touch of canvas weave, and paint a little richer than the photo. (Bristle relief
  // drawn along the strokes was tried: on smooth skies the direction is too unsure and it
  // made a zigzag, so the dabs stay smooth as the filter paints them.)
  float weave = sin(here.x * 2.2) * sin(here.y * 2.2);
  // Clearer: the photo's own fine detail comes back where the picture has firm lines (as a
  // painter draws the forms crisply), then a little more contrast and colour.
  vec3 sharp = photo(here);
  col += (sharp - col) * 0.45 * smoothstep(0.15, 0.6, A);
  vec3 soft = (photo(here + vec2(1.5, 0.0) / uRes) + photo(here - vec2(1.5, 0.0) / uRes)
    + photo(here + vec2(0.0, 1.5) / uRes) + photo(here - vec2(0.0, 1.5) / uRes)) * 0.25;
  col += (sharp - soft) * 0.6;
  col = (col - 0.5) * 1.08 + 0.5;
  col = mix(vec3(luma(col)), col, 1.18) * (0.975 + 0.025 * weave);
  finalColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const STAND_IN: Partial<Record<MeetingMotion, string>> = {
  oilfilter: '🎨',
  datamosh: '📼',
  pixelsort: '🌈',
  scanshift: '📺',
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
  'datamosh',
  'pixelsort',
  'scanshift',
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
      // The oil painting: four passes, the last one reading the photo itself as well.
      const paintUniforms = {
        uImgPos: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
        uImgSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uRes: { value: Math.min(2, window.devicePixelRatio || 1), type: 'f32' },
        uTime: { value: 0, type: 'f32' },
        uWeight: { value: weight, type: 'f32' },
        uDensity: { value: density, type: 'f32' },
      } as const;
      const akf =
        kind === 'oilfilter' && sprite
          ? (() => {
              const pass = (name: string, fragment: string, extra: Record<string, unknown> = {}) =>
                new PIXI.Filter({
                  glProgram: PIXI.GlProgram.from({
                    vertex: PHOTO_VERTEX,
                    fragment: PHOTO_HEAD + AKF_CODEC + fragment,
                    name: `akf-${name}`,
                  }),
                  resources: {
                    photoUniforms: {
                      uTime: { value: 0, type: 'f32' },
                      uWeight: { value: weight, type: 'f32' },
                      uDensity: { value: density, type: 'f32' },
                    },
                    ...extra,
                  },
                });
              const source = sprite.texture.source;
              return [
                pass('tensor', AKF_TENSOR),
                pass('blur-x', AKF_BLUR, {
                  dirUniforms: { uDir: { value: new Float32Array([1, 0]), type: 'vec2<f32>' } },
                }),
                pass('blur-y', AKF_BLUR, {
                  dirUniforms: { uDir: { value: new Float32Array([0, 1]), type: 'vec2<f32>' } },
                }),
                pass('eigen', AKF_EIGEN),
                new PIXI.Filter({
                  glProgram: PIXI.GlProgram.from({
                    vertex: PHOTO_VERTEX,
                    fragment: PHOTO_HEAD + AKF_PAINT,
                    name: 'akf-paint',
                  }),
                  resources: {
                    photoUniforms: paintUniforms,
                    uImage: source,
                    uImageSampler: source.style,
                  },
                }),
              ];
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
        const u = paintUniforms;
        u.uImgPos.value[0] = sprite.x;
        u.uImgPos.value[1] = sprite.y;
        u.uImgSize.value[0] = sprite.width;
        u.uImgSize.value[1] = sprite.height;
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
          const u = (
            akf[akf.length - 1]!.resources as {
              photoUniforms: { uniforms: Record<string, number> };
            }
          ).photoUniforms.uniforms;
          u.uWeight = weight;
          u.uDensity = density;
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
        if (akf) {
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
