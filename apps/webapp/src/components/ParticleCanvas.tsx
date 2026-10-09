import { useEffect, useRef } from 'react';
import type { MeetingMotion, MotionIcon, MotionTune } from '@church/shared';
import { useEnv } from '../lib/env';
import { getMotion } from '../lib/motion';
import { getQuality, useEffectQuality, useUnlimited, watchOffscreen } from '../lib/perf';
import { PARTICLES, SEASON_ITEMS, particleSpots, type Particle } from './particleData';

/**
 * The particle animations (embers, snow, sparkles, leaves, icons…) drawn on one canvas per
 * block instead of one moving element per particle: all the particle effects a block has
 * are drawn together in one picture, by one shared clock at up to 30 frames a second (24 on
 * lite phones), and nothing is drawn while the block is off screen. The paths, timings and
 * looks are those of the CSS particles they replace.
 */

export const PARTICLE_KINDS: ReadonlySet<MeetingMotion> = new Set<MeetingMotion>([
  'embers',
  'bubbles',
  'snow',
  'fireflies',
  'confetti',
  'sparkle',
  'hearts',
  'leaves',
  'snowfall',
  'petals',
  'iconfloat',
  'iconrain',
  'iconorbit',
  'rain',
  'stardust',
  'orbs',
  'meteors',
  'glitter',
  'fireworks',
  'notes',
  'crosses',
]);

export interface ParticleLayer {
  kind: MeetingMotion;
  tune?: MotionTune | null;
}

// ---------- Motion: the CSS keyframes, as functions of the trip's progress (0…1) ----------

type Stops = readonly (readonly [number, number])[];

/** A keyframe track: straight between the stops, as CSS animates `linear` keyframes. */
function track(p: number, stops: Stops): number {
  for (let i = 1; i < stops.length; i++) {
    const [b, vb] = stops[i]!;
    if (p <= b) {
      const [a, va] = stops[i - 1]!;
      return va + ((vb - va) * (p - a)) / (b - a || 1);
    }
  }
  return stops[stops.length - 1]![1];
}

/** CSS ease-in-out, close enough for a moving light. */
const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * p);

/** The same with ease-in-out inside each step (CSS eases every keyframe interval). */
function easedTrack(p: number, stops: Stops): number {
  for (let i = 1; i < stops.length; i++) {
    const [b, vb] = stops[i]!;
    if (p <= b) {
      const [a, va] = stops[i - 1]!;
      return va + (vb - va) * ease((p - a) / (b - a || 1));
    }
  }
  return stops[stops.length - 1]![1];
}

const RISE_OPACITY: Stops = [
  [0, 0],
  [0.1, 1],
  [0.9, 0.9],
  [1, 0],
];
const FALL_OPACITY: Stops = [
  [0, 0],
  [0.1, 1],
  [1, 0.8],
];
/** Sideways sway of the rising / falling paths; every other particle takes the mirror one. */
const SWAY_A: Stops = [
  [0, 0],
  [0.5, 14],
  [1, 0],
];
const SWAY_B: Stops = [
  [0, 0],
  [0.5, -16],
  [1, 0],
];
const TRAVEL: Stops = [
  [0, 0],
  [0.5, 0.6],
  [1, 1.25],
];
const LEAF_A = {
  x: [
    [0, 0],
    [0.25, 24],
    [0.5, -14],
    [0.75, 18],
    [1, 0],
  ] as Stops,
  r: [
    [0, 0],
    [0.25, 110],
    [0.5, 220],
    [0.75, 330],
    [1, 440],
  ] as Stops,
};
const LEAF_B = {
  x: [
    [0, 0],
    [0.25, -22],
    [0.5, 16],
    [0.75, -18],
    [1, 0],
  ] as Stops,
  r: [
    [0, 0],
    [0.25, -120],
    [0.5, -240],
    [0.75, -350],
    [1, -470],
  ] as Stops,
};
const LEAF_Y: Stops = [
  [0, 0],
  [0.25, 0.3],
  [0.5, 0.62],
  [0.75, 0.92],
  [1, 1.25],
];
const LEAF_OPACITY: Stops = [
  [0, 0],
  [0.08, 1],
  [1, 0.85],
];

// ---------- Looks: each particle drawn once into a small picture, then only moved ----------

interface Sprite {
  img: HTMLCanvasElement;
  /** Size of the particle itself (the picture has room around it for its glow). */
  half: number;
}

const sprites = new Map<string, Sprite>();
const EMOJI_FONT = `system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`;

/** A sprite of `size` css px with `pad` px of glow room, drawn by `paint` at `scale`. */
function sprite(
  key: string,
  size: number,
  pad: number,
  scale: number,
  /** Drawn in css px; `k` turns a shadow blur (not scaled with the drawing) into pixels. */
  paint: (ctx: CanvasRenderingContext2D, size: number, k: number) => void,
): Sprite {
  const full = `${key}|${size.toFixed(1)}|${scale}`;
  const hit = sprites.get(full);
  if (hit) return hit;
  const box = size + pad * 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(box * scale));
  c.height = c.width;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(pad, pad);
  paint(ctx, size, scale);
  const s = { img: c, half: box / 2 };
  // A long session never piles up pictures.
  if (sprites.size > 600) sprites.clear();
  sprites.set(full, s);
  return s;
}

const dot = (ctx: CanvasRenderingContext2D, size: number) => {
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
};

function glyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  text: string,
  color: string,
  shadow?: { blur: number; color: string },
  k = 1,
) {
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  if (shadow) {
    ctx.shadowBlur = shadow.blur * k;
    ctx.shadowColor = shadow.color;
  }
  ctx.fillText(text, size / 2, size / 2 + size * 0.04);
}

// ---------- The particles of one layer ----------

interface Item {
  /** Where it sits: across and down in % of the block (down only for fixed ones). */
  x: number;
  y: number;
  size: number;
  /** One trip, and how far into it the particle starts (seconds). */
  dur: number;
  off: number;
  i: number;
}

interface LayerPlan {
  kind: MeetingMotion;
  speed: number;
  alpha: number;
  angle: number;
  scale: number;
  color: string | null;
  items: Item[];
}

/** The particles of a layer — the same spots, sizes and timings as the CSS version. */
function plan(layer: ParticleLayer, lite: boolean, small: boolean): LayerPlan {
  const { kind, tune } = layer;
  const density = tune?.density ?? 1;
  const weight = tune?.weight ?? 1;
  const base: readonly Particle[] =
    kind === 'iconorbit'
      ? PARTICLES.slice(0, 6)
      : kind === 'iconfloat' || kind === 'iconrain'
        ? particleSpots(PARTICLES.slice(0, 9), density)
        : particleSpots(PARTICLES, density);
  const items: Item[] = [];
  base.forEach((p, i) => {
    // Weaker phones draw every other particle; small blocks a third of them.
    if (lite && i % 2) return;
    // A burst is a dozen sparks: a third as many fireworks as other particles (in a small
    // block too — not thinned twice down to none).
    if (kind === 'fireworks') {
      if (i % 3) return;
    } else if (small && i % 3 !== 2 && kind !== 'sparkle' && kind !== 'hearts') return;
    let size = p.s;
    let dur = p.d;
    let off = p.t;
    let y = 0;
    let x = p.x;
    switch (kind) {
      case 'bubbles':
        size = p.s * 2.2;
        dur = p.d * 1.4;
        break;
      case 'snow':
        dur = p.d * 1.3;
        break;
      case 'fireflies':
        size = p.s * 0.9;
        y = (p.t * 9) % 90;
        break;
      case 'confetti':
        size = p.s * 1.4;
        dur = p.d * 1.1;
        break;
      case 'sparkle':
        size = 8 + p.s * 2.2;
        y = (p.t * 23 + p.x) % 92;
        dur = 1.6 + (p.d % 4) * 0.5;
        off = p.t * 0.4;
        break;
      case 'hearts':
        size = 10 + p.s * 2.5;
        dur = p.d * 1.2;
        off = p.t * 1.2;
        break;
      case 'leaves':
      case 'petals':
        size = 12 + p.s * 2.5;
        dur = p.d * 1.5;
        off = p.t * 1.4;
        break;
      case 'snowfall':
        size = 6 + p.s * 2;
        dur = p.d * 1.1;
        off = p.t * 1.4;
        break;
      case 'iconfloat':
      case 'iconrain':
        size = 10 + p.s * 3;
        dur = p.d * 1.3;
        off = p.t * 1.3;
        break;
      case 'iconorbit':
        size = 10 + p.s * 3;
        dur = 16;
        off = p.t * 1.3;
        x = 50;
        break;
      case 'rain':
        size = 14 + p.s * 3;
        dur = 0.7 + (p.d % 3) * 0.25;
        off = p.t * 0.3;
        break;
      case 'stardust':
        size = 3 + p.s * 0.8;
        y = (p.t * 29 + p.x * 3) % 95;
        dur = 3 + (p.d % 5);
        off = p.t * 0.7;
        break;
      case 'orbs':
        size = 36 + p.s * 7;
        y = (p.t * 17 + p.x) % 85;
        dur = p.d * 1.6;
        break;
      case 'meteors':
        size = 60 + p.s * 6;
        y = (p.t * 13) % 45;
        dur = 3 + (p.d % 4);
        off = p.t * 1.1;
        break;
      case 'glitter':
        size = 5 + p.s * 1.2;
        dur = p.d * 1.6;
        off = p.t * 1.3;
        break;
      case 'fireworks':
        size = 4 + p.s * 0.5;
        x = 15 + p.x * 0.7;
        y = 12 + ((p.t * 31) % 45);
        dur = 2.4 + (p.d % 3) * 0.4;
        off = p.t * 0.9;
        break;
      case 'notes':
      case 'crosses':
        size = 12 + p.s * 2.5;
        dur = p.d * 1.25;
        off = p.t * 1.2;
        break;
    }
    items.push({ x, y, size: size * weight, dur, off, i });
  });
  return {
    kind,
    speed: tune?.speed ?? 1,
    alpha: Math.min(1, tune?.strength ?? 1),
    angle: tune?.angle ?? 0,
    scale: tune?.size ?? 1,
    color: tune?.color ?? null,
    items,
  };
}

// ---------- One canvas ----------

class Engine {
  plans: LayerPlan[] = [];
  icon: { img: HTMLImageElement | null; emoji: string } = { img: null, emoji: '✨' };
  width = 0;
  height = 0;
  ratio = 1;
  last = -1;
  /** Being recorded: drawn only when the recorder asks (seekParticles), not by the clock. */
  held = false;
  private ctx: CanvasRenderingContext2D | null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly clip: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d');
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const lite = getQuality() === 'lite';
    this.ratio = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5);
    this.width = this.canvas.offsetWidth || r.width;
    this.height = this.canvas.offsetHeight || r.height;
    this.canvas.width = Math.max(1, Math.round(this.width * this.ratio));
    this.canvas.height = Math.max(1, Math.round(this.height * this.ratio));
    this.last = -1;
  }

  draw(seconds: number) {
    const ctx = this.ctx;
    if (!ctx || !this.width || !this.height) return;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    for (const p of this.plans) this.drawLayer(ctx, p, seconds * p.speed);
  }

  private drawLayer(ctx: CanvasRenderingContext2D, plan: LayerPlan, time: number) {
    let W = this.width;
    let H = this.height;
    ctx.save();
    // Turned or shrunk, the layer's area grows so it still covers the block (as the CSS
    // layer: the area grows, not the particles), then it is turned and sized as a whole.
    if (plan.angle || plan.scale !== 1) {
      const grow = plan.angle % 180 !== 0 || plan.scale < 1 ? 0.4 : plan.angle ? 0.1 : 0;
      ctx.translate(W / 2, H / 2);
      ctx.rotate((plan.angle * Math.PI) / 180);
      ctx.scale(plan.scale, plan.scale);
      W *= 1 + grow * 2;
      H *= 1 + grow * 2;
      ctx.translate(-W / 2, -H / 2);
    }
    for (const it of plan.items) this.drawItem(ctx, plan, it, time, W, H);
    ctx.restore();
  }

  private drawItem(
    ctx: CanvasRenderingContext2D,
    plan: LayerPlan,
    it: Item,
    time: number,
    W: number,
    H: number,
  ) {
    const k = plan.kind;
    const phase = ((((time + it.off) % it.dur) + it.dur) % it.dur) / it.dur;
    const mirror = it.i % 2 === 1;
    const left = (it.x / 100) * W;
    let cx = left + it.size / 2;
    let cy = 0;
    let alpha = 1;
    let rot = 0;
    let scaleX = 1;
    let scale = 1;
    switch (k) {
      case 'embers':
      case 'bubbles':
      case 'hearts':
      case 'notes':
      case 'crosses':
      case 'iconfloat': {
        const big = k === 'iconfloat' || k === 'hearts' || k === 'notes' || k === 'crosses';
        cy = H * (1 + (big ? 0.14 : 0.1)) - it.size / 2 - track(phase, TRAVEL) * H;
        cx += track(phase, mirror ? SWAY_B : SWAY_A);
        alpha = track(phase, RISE_OPACITY) * (big ? 0.85 : 1);
        break;
      }
      case 'rain': {
        // Straight down and a little sideways, like rain in a light wind.
        cy = -H * 0.15 + phase * H * 1.3;
        cx += phase * H * 0.12;
        rot = -5;
        alpha = 0.6;
        break;
      }
      case 'stardust': {
        cy = (it.y / 100) * H - phase * H * 0.12;
        cx += Math.sin(phase * Math.PI * 2 + it.i) * 6;
        alpha = Math.sin(Math.PI * phase) * (0.6 + 0.4 * Math.sin(time * 3 + it.i));
        break;
      }
      case 'orbs': {
        // Slow wandering, breathing light.
        const span = it.dur;
        const wp = ((((time + it.off) % (span * 2)) + span * 2) % (span * 2)) / span;
        const pp = wp > 1 ? 2 - wp : wp;
        cx += easedTrack(pp, [
          [0, 0],
          [0.5, 40],
          [1, -20],
        ]);
        cy =
          (it.y / 100) * H +
          easedTrack(pp, [
            [0, 0],
            [0.5, -26],
            [1, 18],
          ]);
        alpha = 0.45 + 0.25 * Math.sin(time * 0.9 + it.i);
        break;
      }
      case 'meteors': {
        // A streak across the top part, then a pause until the next one.
        if (phase > 0.35) return;
        const q = phase / 0.35;
        cx = left + W * 0.3 - q * W * 0.5;
        cy = (it.y / 100) * H + q * H * 0.35;
        rot = (Math.atan2(H * 0.35, -W * 0.5) * 180) / Math.PI;
        alpha = Math.sin(Math.PI * q);
        break;
      }
      case 'glitter': {
        const path = mirror ? LEAF_B : LEAF_A;
        cy = -H * 0.12 + it.size / 2 + track(phase, LEAF_Y) * H;
        cx += track(phase, path.x) * 0.6;
        rot = track(phase, path.r);
        alpha = track(phase, LEAF_OPACITY) * (0.55 + 0.45 * Math.sin(time * 5 + it.i * 1.7));
        break;
      }
      case 'fireworks': {
        // A burst: a ring of sparks flying out, falling a little and fading.
        const sp = this.spriteFor(plan, it);
        if (!sp) return;
        const out = 1 - (1 - phase) ** 3;
        const R = Math.min(W, H) * 0.17 * out;
        const fade = (1 - phase) ** 1.5 * plan.alpha;
        if (fade <= 0.01) return;
        const ox = left;
        const oy = (it.y / 100) * H + phase * phase * H * 0.06;
        ctx.globalAlpha = fade;
        for (let j = 0; j < 12; j++) {
          const a = (j / 12) * Math.PI * 2 + it.i;
          const sx = ox + Math.cos(a) * R;
          const sy = oy + Math.sin(a) * R;
          ctx.drawImage(sp.img, sx - sp.half, sy - sp.half, sp.half * 2, sp.half * 2);
        }
        return;
      }
      case 'snow':
      case 'iconrain': {
        const startTop = k === 'iconrain' ? 0.14 : 0.1;
        cy = -H * startTop + it.size / 2 + track(phase, TRAVEL) * H;
        cx += track(phase, mirror ? SWAY_B : SWAY_A);
        alpha = track(phase, FALL_OPACITY) * (k === 'iconrain' ? 0.85 : 1);
        break;
      }
      case 'confetti': {
        cy = -H * 0.1 + it.size * 0.9 + track(phase, TRAVEL) * H;
        cx += track(phase, SWAY_A) * (16 / 14);
        rot = track(phase, [
          [0, 0],
          [0.5, 220],
          [1, 480],
        ]);
        scaleX = Math.cos(
          (track(phase, [
            [0, 0],
            [0.5, 180],
            [1, 360],
          ]) *
            Math.PI) /
            180,
        );
        alpha = track(phase, [
          [0, 0],
          [0.08, 1],
          [1, 0.9],
        ]);
        break;
      }
      case 'leaves':
      case 'petals':
      case 'snowfall': {
        const path = mirror ? LEAF_B : LEAF_A;
        cy = -H * 0.12 + it.size / 2 + track(phase, LEAF_Y) * H;
        cx += track(phase, path.x);
        rot = track(phase, path.r);
        alpha = track(phase, LEAF_OPACITY);
        break;
      }
      case 'fireflies': {
        // Wandering back and forth, blinking at its own pace.
        const span = it.dur * 1.6;
        const wp = ((((time + it.off) % (span * 2)) + span * 2) % (span * 2)) / span;
        const pp = wp > 1 ? 2 - wp : wp;
        cx += easedTrack(pp, [
          [0, 0],
          [0.33, 22],
          [0.66, -14],
          [1, 8],
        ]);
        cy =
          (it.y / 100) * H +
          it.size / 2 +
          easedTrack(pp, [
            [0, 0],
            [0.33, -14],
            [0.66, 10],
            [1, -22],
          ]);
        const blink = it.dur / 3;
        const bp = ((((time + it.off) % blink) + blink) % blink) / blink;
        alpha = easedTrack(bp, [
          [0, 0.15],
          [0.5, 1],
          [1, 0.15],
        ]);
        break;
      }
      case 'sparkle': {
        cy = (it.y / 100) * H + it.size / 2;
        const v = easedTrack(phase, [
          [0, 0],
          [0.5, 1],
          [1, 0],
        ]);
        scale = 0.2 + 0.8 * v;
        rot = 90 * v;
        alpha = v;
        break;
      }
      case 'iconorbit': {
        const a = phase * Math.PI * 2;
        const r = 0.34 * Math.min(W, H);
        cx = W / 2 + Math.cos(a) * r;
        cy = H / 2 + Math.sin(a) * r;
        alpha = 0.85;
        break;
      }
    }
    alpha *= plan.alpha;
    if (alpha <= 0.01) return;
    const s = this.spriteFor(plan, it);
    if (!s) return;
    ctx.globalAlpha = alpha;
    if (!rot && scaleX === 1 && scale === 1) {
      ctx.drawImage(s.img, cx - s.half, cy - s.half, s.half * 2, s.half * 2);
      return;
    }
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(scaleX * scale, scale);
    ctx.drawImage(s.img, -s.half, -s.half, s.half * 2, s.half * 2);
    ctx.restore();
  }

  private spriteFor(plan: LayerPlan, it: Item): Sprite | null {
    const r = this.ratio;
    const size = Math.max(1, it.size);
    const c = plan.color;
    switch (plan.kind) {
      case 'embers':
        return sprite(`ember|${c}`, size, 12, r, (ctx, s, k) => {
          // The glow: the dot 2px wider, blurred (the CSS box-shadow), under the dot.
          ctx.shadowBlur = 8 * k;
          ctx.shadowColor = 'rgba(251,146,60,0.6)';
          ctx.fillStyle = 'rgba(251,146,60,0.6)';
          ctx.beginPath();
          ctx.arc(s / 2, s / 2, s / 2 + 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
          g.addColorStop(0, '#fff7d6');
          g.addColorStop(0.45, c ?? '#fbbf24');
          g.addColorStop(0.7, c ?? '#f97316');
          g.addColorStop(0.72, 'rgba(249,115,22,0)');
          ctx.fillStyle = g;
          dot(ctx, s);
          ctx.fill();
        });
      case 'bubbles':
        return sprite(`bubble|${c}`, size, 2, r, (ctx, s) => {
          const g = ctx.createRadialGradient(s * 0.3, s * 0.3, 0, s * 0.3, s * 0.3, s * 0.45);
          g.addColorStop(0, c ? `${c}73` : 'rgba(255,255,255,0.45)');
          g.addColorStop(1, c ? `${c}00` : 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          dot(ctx, s);
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = c ? `${c}8c` : 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(s / 2, s / 2, s / 2 - 0.75, 0, Math.PI * 2);
          ctx.stroke();
        });
      case 'snow':
        return sprite(`snow|${c}`, size, 2, r, (ctx, s, k) => {
          ctx.shadowBlur = k;
          ctx.shadowColor = c ?? 'rgba(255,255,255,0.85)';
          ctx.fillStyle = c ?? 'rgba(255,255,255,0.85)';
          dot(ctx, s);
          ctx.fill();
        });
      case 'fireflies':
        return sprite(`firefly|${c}`, size, 18, r, (ctx, s, k) => {
          ctx.shadowBlur = 14 * k;
          ctx.shadowColor = c ?? 'rgba(250,204,21,0.5)';
          ctx.fillStyle = c ?? '#fde68a';
          dot(ctx, s);
          ctx.fill();
          ctx.shadowBlur = 6 * k;
          ctx.shadowColor = c ?? '#fde047';
          ctx.fill();
        });
      case 'confetti': {
        const color = c ?? `hsl(${(it.i * 47) % 360} 90% 62%)`;
        return sprite(`confetti|${color}`, size * 1.8, 1, r, (ctx, s) => {
          ctx.fillStyle = color;
          const w = s / 1.8;
          ctx.fillRect((s - w) / 2, 0, w, s);
        });
      }
      case 'sparkle':
        return sprite(`spark|${c}`, size, 10, r, (ctx, s, k) =>
          glyph(ctx, s, '✦', c ?? '#fff', { blur: 8, color: c ?? '#fff' }, k),
        );
      case 'hearts':
        return sprite(`heart|${c}`, size, 10, r, (ctx, s, k) =>
          glyph(ctx, s, '♥', c ?? '#f43f5e', { blur: 8, color: 'rgba(255,255,255,0.35)' }, k),
        );
      case 'leaves':
      case 'petals':
      case 'snowfall': {
        const items = SEASON_ITEMS[plan.kind];
        const text = items[it.i % items.length]!;
        const snowy = plan.kind === 'snowfall';
        return sprite(`${plan.kind}|${text}|${c}`, size, snowy ? 6 : 2, r, (ctx, s, k) =>
          glyph(
            ctx,
            s,
            text,
            c ?? '#fff',
            snowy ? { blur: 3, color: 'rgba(255,255,255,0.7)' } : undefined,
            k,
          ),
        );
      }
      case 'rain':
        return sprite(`rain|${c}`, size, 2, r, (ctx, s) => {
          const g = ctx.createLinearGradient(0, 0, 0, s);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(1, c ?? '#cfe8ff');
          ctx.strokeStyle = g;
          ctx.lineWidth = Math.max(1, s * 0.06);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s / 2, 0);
          ctx.lineTo(s / 2, s);
          ctx.stroke();
        });
      case 'stardust':
        return sprite(`dust|${c}`, size, 8, r, (ctx, s, k) => {
          ctx.shadowBlur = 6 * k;
          ctx.shadowColor = c ?? '#fde68a';
          ctx.fillStyle = c ?? '#fff7d6';
          dot(ctx, s);
          ctx.fill();
        });
      case 'orbs':
        return sprite(`orb|${c}`, size, 0, r, (ctx, s) => {
          const col = c ?? '#f0abfc';
          const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
          g.addColorStop(0, `${col}e6`);
          g.addColorStop(0.45, `${col}66`);
          g.addColorStop(1, `${col}00`);
          ctx.fillStyle = g;
          dot(ctx, s);
          ctx.fill();
        });
      case 'meteors':
        return sprite(`meteor|${c}`, size, 6, r, (ctx, s, k) => {
          // A tail fading out behind a bright head (the head points along the travel).
          const g = ctx.createLinearGradient(0, s / 2, s, s / 2);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.8, c ?? '#bae6fd');
          g.addColorStop(1, '#ffffff');
          ctx.strokeStyle = g;
          ctx.lineWidth = Math.max(1.5, s * 0.035);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(0, s / 2);
          ctx.lineTo(s, s / 2);
          ctx.stroke();
          ctx.shadowBlur = 8 * k;
          ctx.shadowColor = c ?? '#ffffff';
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(s - 2, s / 2, Math.max(1.5, s * 0.03), 0, Math.PI * 2);
          ctx.fill();
        });
      case 'glitter': {
        const col = c ?? `hsl(${(it.i * 53) % 360} 95% 70%)`;
        return sprite(`glitter|${col}`, size, 6, r, (ctx, s, k) =>
          glyph(ctx, s, '◆', col, { blur: 5, color: col }, k),
        );
      }
      case 'fireworks': {
        const col = c ?? `hsl(${(it.i * 67) % 360} 95% 65%)`;
        return sprite(`spark2|${col}`, size, 8, r, (ctx, s, k) => {
          ctx.shadowBlur = 7 * k;
          ctx.shadowColor = col;
          ctx.fillStyle = '#ffffff';
          dot(ctx, s);
          ctx.fill();
          ctx.shadowBlur = 3 * k;
          ctx.fillStyle = col;
          ctx.fill();
        });
      }
      case 'notes': {
        const text = ['♪', '♫', '♬'][it.i % 3]!;
        return sprite(`note|${text}|${c}`, size, 8, r, (ctx, s, k) =>
          glyph(ctx, s, text, c ?? '#ffffff', { blur: 6, color: c ?? 'rgba(255,255,255,0.6)' }, k),
        );
      }
      case 'crosses':
        return sprite(`cross|${c}`, size, 10, r, (ctx, s, k) =>
          glyph(ctx, s, '✝', c ?? '#fde68a', { blur: 9, color: c ?? '#fde68a' }, k),
        );
      case 'iconfloat':
      case 'iconrain':
      case 'iconorbit': {
        const img = this.icon.img;
        if (img) {
          if (!img.complete || !img.naturalWidth) return null;
          return sprite(`icon|${img.src}`, size, 1, r, (ctx, s) => {
            const k = Math.min(s / img.naturalWidth, s / img.naturalHeight);
            const w = img.naturalWidth * k;
            const h = img.naturalHeight * k;
            ctx.beginPath();
            ctx.roundRect((s - w) / 2, (s - h) / 2, w, h, Math.min(w, h) * 0.22);
            ctx.clip();
            ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
          });
        }
        return sprite(`emoji|${this.icon.emoji}`, size, 2, r, (ctx, s) =>
          glyph(ctx, s * 0.85, this.icon.emoji, '#fff'),
        );
      }
      default:
        return null;
    }
  }
}

// ---------- The shared clock ----------

const engines = new Set<Engine>();
let frame = 0;

/** Moving is off on this phone (its setting, the system's "reduce motion", or "still"). */
function standing(): boolean {
  return (
    getMotion() === 'off' ||
    getQuality() === 'still' ||
    (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

function tick(now: number) {
  frame = 0;
  if (!engines.size) return;
  const html = document.documentElement;
  const lite = getQuality() === 'lite';
  const gap = 1000 / (lite ? 20 : 24);
  const still = standing();
  if (!document.hidden && !(lite && html.dataset.scrolling)) {
    for (const e of engines) {
      if (e.held) continue;
      // Off screen or over the running limit (watchOffscreen marks it): nothing to draw.
      if (e.clip.hasAttribute('data-off') && e.last >= 0) continue;
      // A copy kept still (the Design tab's page copy until "play") gets one frame too.
      if (still || e.clip.closest('.motion-still')) {
        // One still frame, a few seconds in so the particles are spread out.
        if (e.last < 0) {
          e.draw(4);
          e.last = now;
        }
        continue;
      }
      if (now - e.last < gap) continue;
      e.last = now;
      e.draw(now / 1000);
    }
  }
  frame = requestAnimationFrame(tick);
}

/** Recording: the canvases inside `root` stop following the clock (or follow it again). */
export function holdParticles(root: Element, hold: boolean) {
  for (const e of engines) if (root.contains(e.clip)) e.held = hold;
}

/** Recording: draws the canvases inside `root` as they are `seconds` into their animation. */
export function seekParticles(root: Element, seconds: number) {
  for (const e of engines)
    if (root.contains(e.clip)) {
      if (!e.width) e.resize();
      e.draw(seconds);
    }
}

function start(e: Engine) {
  engines.add(e);
  if (!frame) frame = requestAnimationFrame(tick);
}

function stop(e: Engine) {
  engines.delete(e);
  if (!engines.size && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}

// ---------- The component ----------

/**
 * All the particle layers of one block on one canvas. `layers` keep their own settings
 * (speed, size, angle, colour, how many, how big, how strong).
 */
export function ParticleCanvas({
  layers,
  icon,
  behind,
  preview,
}: {
  layers: ParticleLayer[];
  icon?: MotionIcon | null;
  behind?: boolean;
  preview?: boolean;
}) {
  const clip = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const quality = useEffectQuality();
  const unlimited = useUnlimited();
  const { env } = useEnv();
  const iconUrl = icon?.url ?? (icon?.emoji ? null : (env?.logoUrl ?? null));
  const iconEmoji = icon?.emoji ?? '✨';
  const key = JSON.stringify(layers);

  // Off screen it stands still, and it counts against the layers allowed to run at once.
  useEffect(
    () =>
      clip.current
        ? watchOffscreen(clip.current, !unlimited && (!preview || quality !== 'full'))
        : undefined,
    [quality, preview, unlimited],
  );

  useEffect(() => {
    if (!canvas.current || !clip.current) return;
    const e = new Engine(canvas.current, clip.current);
    engine.current = e;
    e.resize();
    const ro = new ResizeObserver(() => e.resize());
    ro.observe(canvas.current);
    start(e);
    return () => {
      ro.disconnect();
      stop(e);
      engine.current = null;
    };
  }, [quality]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const lite = quality === 'lite';
    // Small blocks (chips, the tab bar) draw a third of the particles, as the CSS does.
    const small = (clip.current?.offsetHeight ?? 999) <= 110;
    e.plans = (JSON.parse(key) as ParticleLayer[]).map((l) => plan(l, lite, small));
    if (iconUrl) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (e.icon.img === img) e.last = -1;
      };
      img.src = iconUrl;
      e.icon = { img, emoji: iconEmoji };
    } else e.icon = { img: null, emoji: iconEmoji };
    e.last = -1;
  }, [key, iconUrl, iconEmoji, quality]);

  if (quality === 'still' || !layers.length) return null;
  return (
    <span
      ref={clip}
      aria-hidden="true"
      className="living-clip living-canvas"
      style={behind ? { zIndex: -1 } : undefined}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </span>
  );
}

/** Splits a block's animations: the particle ones go together on one canvas. */
export function splitParticles<T extends ParticleLayer>(
  layers: T[],
): { particles: T[]; others: T[] } {
  const particles: T[] = [];
  const others: T[] = [];
  for (const l of layers) (PARTICLE_KINDS.has(l.kind) ? particles : others).push(l);
  return { particles, others };
}
