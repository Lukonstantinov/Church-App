/**
 * Slideshows (FreePoster «Слайды»): slides of their own layers over one moving background,
 * changing with a transition. One pure description of each transition at progress p (0 … 1)
 * is used by both the live preview (CSS on the two slides' boxes) and the recorder (canvas),
 * so a recording shows what the screen showed. Recipes after Fable's motion-design brief.
 */

import type { PosterLayer } from '@church/shared';

/** One slide: its own layers, how long it is on (s), and how the poster changes into it. */
export interface Slide {
  id: string;
  layers: PosterLayer[];
  seconds: number;
  transition: SlideTransition;
}

/** How long a change between slides takes (s): the first part of the incoming slide. */
export const SLIDE_CHANGE_SECONDS = 0.8;

/**
 * Where a slideshow is `t` seconds in (looping): the slide on, and in the first `change`
 * seconds of a slide the one it changes from (`prev`) and how far the change is (p 0 … 1).
 */
export function slideAt(slides: Slide[], t: number, change: number) {
  const n = slides.length;
  const total = slides.reduce((a, b) => a + b.seconds, 0);
  if (n === 0 || total <= 0) return { index: 0, prev: null as number | null, p: 1 };
  let x = ((t % total) + total) % total;
  let i = 0;
  while (i < n - 1 && x >= slides[i]!.seconds) x -= slides[i++]!.seconds;
  if (n > 1 && x < change) return { index: i, prev: (i - 1 + n) % n, p: x / change };
  return { index: i, prev: null as number | null, p: 1 };
}

export const SLIDE_TRANSITIONS = [
  'glitch',
  'fade',
  'zoom',
  'blur',
  'slide',
  'flash',
  'cut',
] as const;
export type SlideTransition = (typeof SLIDE_TRANSITIONS)[number];

/** How one of the two slides looks at a moment of the change. */
export interface SlideLook {
  opacity: number;
  /** Moved, in parts of the poster's width / height. */
  tx: number;
  ty: number;
  scale: number;
  /** Blur, in parts of the poster's smaller side. */
  blur: number;
  /**
   * Glitch only: the horizontal bands this slide shows (top / bottom in parts of the height)
   * and how far each is pushed sideways (part of the width). Null = the whole slide.
   */
  bands: { y0: number; y1: number; dx: number }[] | null;
  /** Glitch only: colour fringes, pushed this far apart (part of the width). */
  split: number;
}

export interface TransitionFrame {
  out: SlideLook;
  in: SlideLook;
  /** A white flash over both (0 … 1). */
  flash: number;
}

const plain = (opacity = 1): SlideLook => ({
  opacity,
  tx: 0,
  ty: 0,
  scale: 1,
  blur: 0,
  bands: null,
  split: 0,
});

/** A repeatable random number 0 … 1 from whole numbers. */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const ROWS = 14;

/** Both slides at progress `p` of a change of `kind`; `seed` varies the glitch per change. */
export function transitionAt(kind: SlideTransition, p: number, seed = 0): TransitionFrame {
  const q = Math.min(1, Math.max(0, p));
  const e = q * q * (3 - 2 * q);
  switch (kind) {
    case 'fade':
      return { out: plain(1 - e), in: plain(e), flash: 0 };
    case 'zoom':
      return {
        out: { ...plain(1 - e), scale: 1 + 0.25 * e },
        in: { ...plain(e), scale: 1.15 - 0.15 * e },
        flash: 0,
      };
    case 'slide':
      return { out: { ...plain(), tx: -e }, in: { ...plain(), tx: 1 - e }, flash: 0 };
    case 'blur': {
      const b = 0.04 * Math.sin(Math.PI * q);
      const mix = Math.min(1, Math.max(0, (q - 0.35) / 0.3));
      return {
        out: { ...plain(1 - mix), blur: b },
        in: { ...plain(mix), blur: b },
        flash: 0,
      };
    }
    case 'flash': {
      const f = 1 - Math.abs(2 * q - 1);
      return { out: plain(q < 0.5 ? 1 : 0), in: plain(q < 0.5 ? 0 : 1), flash: f * f };
    }
    case 'cut':
      return { out: plain(q < 0.5 ? 1 : 0), in: plain(q < 0.5 ? 0 : 1), flash: 0 };
    case 'glitch': {
      // Steps, not a glide: the picture jumps about 12 times over the change.
      const step = Math.floor(q * 12);
      const a = Math.sin(Math.PI * q);
      const outBands: SlideLook['bands'] = [];
      const inBands: SlideLook['bands'] = [];
      for (let j = 0; j < ROWS; j++) {
        // Uneven bands, so the break doesn't look like a grid.
        const y0 = edge(j, seed);
        const y1 = edge(j + 1, seed);
        const pushed = hash(j, step, seed + 7) < a;
        const dx = pushed ? (hash(j, step, seed) - 0.5) * 0.3 * a : 0;
        // A band shows the new slide once p passes its own moment: it breaks apart rather
        // than fading.
        (hash(j, seed, 3) > q ? outBands : inBands).push({ y0, y1, dx });
      }
      const split = 0.02 * a;
      return {
        out: { ...plain(), bands: outBands, split },
        in: { ...plain(), bands: inBands, split },
        flash: 0,
      };
    }
  }
}

/** The top of band j (0 … ROWS), uneven but in order, the same for the whole change. */
function edge(j: number, seed: number): number {
  if (j <= 0) return 0;
  if (j >= ROWS) return 1;
  return (j + (hash(j, seed, 11) - 0.5) * 0.7) / ROWS;
}

/**
 * The look as CSS for a slide's box in the live preview. A glitch shows its bands through
 * one clip path (the bands joined along the left edge) and jumps sideways as its widest
 * band does, with the colour fringes as two coloured shadows; the recording pushes every
 * band on its own (drawLook) — the same bands, the same moments.
 */
export function lookStyle(look: SlideLook): Record<string, string | number> {
  const style: Record<string, string | number> = {};
  if (look.opacity < 1) style.opacity = look.opacity;
  let tx = look.tx;
  if (look.bands) {
    if (look.bands.length === 0) return { opacity: 0 };
    const pts: string[] = [];
    for (const b of look.bands)
      pts.push(`0 ${pct(b.y0)}`, `100% ${pct(b.y0)}`, `100% ${pct(b.y1)}`, `0 ${pct(b.y1)}`);
    style.clipPath = `polygon(${pts.join(', ')})`;
    const widest = look.bands.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
    tx += widest.dx;
  }
  if (tx || look.ty || look.scale !== 1)
    style.transform = `translate(${pct(tx)}, ${pct(look.ty)}) scale(${look.scale})`;
  const filters: string[] = [];
  if (look.blur > 0) filters.push(`blur(${(look.blur * 100).toFixed(2)}cqmin)`);
  if (look.split > 0)
    filters.push(
      `drop-shadow(${(look.split * 100).toFixed(2)}cqw 0 rgba(255,0,60,0.55))`,
      `drop-shadow(${(-look.split * 100).toFixed(2)}cqw 0 rgba(0,220,255,0.55))`,
    );
  if (filters.length) style.filter = filters.join(' ');
  return style;
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

/**
 * Draws a slide's frame (`src`, the size of `ctx`) onto `ctx` the way `look` says — the
 * recorder's side of a change. Blur is a smaller copy enlarged (canvas blur filters are
 * missing on iPhones), the colour fringes copies tinted red and cyan added beside it.
 */
export function drawLook(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, look: SlideLook) {
  const { width: W, height: H } = ctx.canvas;
  if (look.opacity <= 0 || (look.bands && look.bands.length === 0)) return;
  let pic: HTMLCanvasElement = src;
  let temp: HTMLCanvasElement | null = null;
  if (look.blur > 0) {
    const r = Math.max(1, look.blur * Math.min(W, H));
    const s = Math.max(1, r / 1.5);
    const tw = Math.max(1, Math.round(W / s));
    const th = Math.max(1, Math.round(H / s));
    const tiny = document.createElement('canvas');
    tiny.width = tw;
    tiny.height = th;
    const t = tiny.getContext('2d')!;
    t.imageSmoothingQuality = 'high';
    t.drawImage(src, 0, 0, tw, th);
    temp = document.createElement('canvas');
    temp.width = W;
    temp.height = H;
    const g = temp.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(tiny, 0, 0, W, H);
    tiny.width = tiny.height = 0;
    pic = temp;
  }
  ctx.save();
  ctx.globalAlpha *= look.opacity;
  if (look.bands) {
    // Each band pushed on its own; then fringes of the same bands, red one way, cyan the other.
    const bands = look.bands;
    const slices = (c: CanvasRenderingContext2D, img: CanvasImageSource, shift: number) => {
      for (const b of bands) {
        const y = Math.round(b.y0 * H);
        const h = Math.max(1, Math.round(b.y1 * H) - y);
        c.drawImage(img, 0, y, W, h, Math.round((b.dx + shift) * W), y, W, h);
      }
    };
    slices(ctx, pic, 0);
    if (look.split > 0) {
      for (const [colour, dir] of [
        ['rgb(255,0,60)', 1],
        ['rgb(0,220,255)', -1],
      ] as const) {
        const tint = document.createElement('canvas');
        tint.width = W;
        tint.height = H;
        const c = tint.getContext('2d')!;
        slices(c, pic, look.split * dir);
        c.globalCompositeOperation = 'source-atop';
        c.fillStyle = colour;
        c.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.55 * look.opacity;
        ctx.drawImage(tint, 0, 0);
        tint.width = tint.height = 0;
      }
    }
  } else {
    const w = W * look.scale;
    const h = H * look.scale;
    ctx.drawImage(pic, (W - w) / 2 + look.tx * W, (H - h) / 2 + look.ty * H, w, h);
  }
  ctx.restore();
  if (temp) temp.width = temp.height = 0;
}

/** A white flash over the frame. */
export function drawFlash(ctx: CanvasRenderingContext2D, flash: number) {
  if (flash <= 0) return;
  ctx.save();
  ctx.globalAlpha = flash;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
