import type { MeetingMotion } from '@church/shared';

/**
 * Text in motion: the person's own words as a moving background (a waving wall of rows, a
 * tunnel, rings, stacked echoes, crossing tapes, a glitching title, falling words). Drawn on
 * the block's particle canvas the way the word wall is: the text is drawn once into small
 * pictures (in its font, colours, outline and glow) and every frame only places, turns and
 * sizes those pictures — text drawn anew every frame was measured many times slower.
 *
 * Every picture is a pure function of the time given (no state kept between frames, no
 * Math.random): a recording steps through time in its own order and must get the same film.
 */

type RGB = [number, number, number];

/** The words and look of a text effect (from its tune), with the pictures made for it. */
export interface TextFx {
  words: string[];
  font: string;
  /** The tune's «how many» (1 = as designed). */
  density: number;
  /** The tune's letter size (1 = as designed). */
  size: number;
  glow: number;
  colors: string[] | null;
  style: 'fill' | 'outline' | 'mix';
  flow: 'alt' | 'same' | 'still';
  /** How wild: the wave's height, the tunnel's sway, how often the title glitches (0…1). */
  chaos: number;
  seed: number;
  fx?: { key: string; data: unknown };
}

/** What the canvas tells an effect about itself. */
export interface TextEnv {
  /** Canvas pixels per page pixel. */
  ratio: number;
  /** The block's real size (the area given to draw in is bigger when the layer is turned). */
  width: number;
  height: number;
  /** The word when none is given (the ministry's name). */
  fallback: string;
  /** The block's own colours, when the tune has none. */
  own: () => string[];
  /** Bumped when web fonts arrive: the pictures are drawn again in them. */
  fonts: number;
  alpha: number;
}

const TAU = Math.PI * 2;
const frac = (v: number) => v - Math.floor(v);
/** A steady pseudo-random 0…1 for a number (the same every time). */
const hash = (v: number) => frac(Math.sin(v * 127.1 + 311.7) * 43758.5453);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

function rgbOf(c: string): RGB | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  return null;
}
const css = (c: RGB, a = 1) =>
  a >= 1
    ? `rgb(${c.map((v) => Math.round(v)).join(',')})`
    : `rgba(${c.map((v) => Math.round(v)).join(',')},${a})`;
/** A colour `at` (0…1) along the list. */
function along(list: RGB[], at: number): RGB {
  if (list.length === 1) return list[0]!;
  const f = clamp(at, 0, 0.9999) * (list.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const a = list[i]!;
  const b = list[i + 1]!;
  return [0, 1, 2].map((j) => a[j]! + (b[j]! - a[j]!) * k) as RGB;
}
const luminance = (c: RGB) => (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;

/** The effect's colours: the tune's own, else the block's (the ministry's). */
function palette(fx: TextFx, env: TextEnv): RGB[] {
  const list = (fx.colors ?? env.own()).map(rgbOf).filter((c): c is RGB => !!c);
  return list.length ? list : [[255, 255, 255]];
}

let ruler: CanvasRenderingContext2D | null = null;
/** The width of a text in a font, in the font's own pixels. */
function widthOf(font: string, text: string): number {
  ruler ??= document.createElement('canvas').getContext('2d');
  if (!ruler) return text.length * 10;
  ruler.font = font;
  return ruler.measureText(text).width;
}

const fontOf = (px: number, family: string) => `900 ${px}px ${family}`;
const wordsOf = (fx: TextFx, env: TextEnv) =>
  (fx.words.length ? fx.words : [env.fallback]).map((w) => w.toUpperCase());

/** A picture of text made once: the canvas and its size on the page. */
interface Sprite {
  c: HTMLCanvasElement;
  w: number;
  h: number;
  /** Empty room round the text (for its glow). */
  pad: number;
  /** The text's own width. */
  tw: number;
}

interface Look {
  /** One colour, or several as a gradient across the letters. */
  colours: RGB[];
  outline?: boolean;
  glow?: number;
  /** Drawn this much smaller than shown (0.2 = a fifth): shown, it is softly out of focus. */
  soft?: number;
  /** No room at the sides: copies set side by side join into one endless line. */
  tile?: boolean;
  /** The gradient ends in its first colour again (so tiled copies join). */
  cyclic?: boolean;
}

/** One line of text as a picture. */
function lineSprite(env: TextEnv, text: string, px: number, family: string, look: Look): Sprite {
  const font = fontOf(px, family);
  const glow = look.glow ?? 0;
  let tw = Math.max(1, widthOf(font, text));
  const pad = Math.ceil(px * (0.14 + glow * 0.5));
  const side = look.tile ? 0 : pad;
  let q = env.ratio * (look.soft ?? 1);
  // Kept under what a phone's canvas may be: a very long line is drawn less sharp instead.
  q = Math.min(q, 4096 / (tw + side * 2));
  // A tiled line is a whole number of canvas pixels wide, or the copies would show a seam.
  if (look.tile) tw = Math.max(1, Math.round(tw * q)) / q;
  const w = tw + side * 2;
  const h = px * 1.1 + pad * 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * q));
  c.height = Math.max(1, Math.ceil(h * q));
  const g = c.getContext('2d')!;
  g.scale(q, q);
  g.font = font;
  g.textBaseline = 'middle';
  let paint: string | CanvasGradient = css(look.colours[0]!);
  if (look.colours.length > 1) {
    const list = look.cyclic ? [...look.colours, look.colours[0]!] : look.colours;
    const grad = g.createLinearGradient(side, 0, side + tw, 0);
    list.forEach((col, i) => grad.addColorStop(i / (list.length - 1), css(col)));
    paint = grad;
  }
  if (glow) {
    g.shadowColor = css(along(look.colours, 0.5));
    g.shadowBlur = px * 0.35 * glow;
  }
  const y = pad + px * 0.57;
  if (look.outline) {
    g.strokeStyle = paint;
    g.lineWidth = Math.max(1 / q, px * 0.04);
    g.lineJoin = 'round';
    g.strokeText(text, side, y);
  } else {
    g.fillStyle = paint;
    g.fillText(text, side, y);
  }
  return { c, w, h, pad, tw };
}

/**
 * Text set round a circle (repeated to fill it, the letters spread a little so the last
 * copy meets the first), as one square picture: turning it turns the ring.
 */
function ringSprite(
  env: TextEnv,
  text: string,
  px: number,
  radius: number,
  family: string,
  look: Look,
): Sprite {
  const font = fontOf(px, family);
  const glow = look.glow ?? 0;
  const pad = Math.ceil(px * (0.6 + glow * 0.5));
  const size = (radius + pad) * 2;
  const q = Math.min(env.ratio, 1400 / size);
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(1, Math.round(size * q));
  const g = c.getContext('2d')!;
  g.scale(q, q);
  g.translate(size / 2, size / 2);
  g.font = font;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1 / q, px * 0.045);
  const chars = [...text];
  const widths = chars.map((ch) => widthOf(font, ch));
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const round = TAU * radius;
  const copies = Math.max(1, Math.round(round / total));
  const stretch = round / (copies * total);
  const cyc = look.colours.length > 1 ? [...look.colours, look.colours[0]!] : look.colours;
  let at = 0;
  for (let n = 0; n < copies; n++)
    chars.forEach((ch, i) => {
      const w = widths[i]! * stretch;
      const angle = (at + w / 2) / radius;
      at += w;
      if (ch.trim() === '') return;
      const colour = css(along(cyc, angle / TAU));
      g.save();
      g.rotate(angle);
      if (glow) {
        g.shadowColor = colour;
        g.shadowBlur = px * 0.35 * glow;
      }
      if (look.outline) {
        g.strokeStyle = colour;
        g.strokeText(ch, 0, -radius);
      } else {
        g.fillStyle = colour;
        g.fillText(ch, 0, -radius);
      }
      g.restore();
    });
  return { c, w: size, h: size, pad, tw: radius * 2 };
}

/** The pictures of an effect, made again only when what they depend on changes. */
function cached<T>(fx: TextFx, env: TextEnv, kind: string, extra: string, make: () => T): T {
  const key = `${kind}|${Math.round(env.width)}x${Math.round(env.height)}|${env.ratio}|${fx.words.join('|')}|${env.fallback}|${fx.font}|${fx.density}|${fx.size}|${fx.glow}|${fx.style}|${(fx.colors ?? []).join()}|${env.fonts}|${extra}`;
  if (fx.fx?.key !== key) fx.fx = { key, data: make() };
  return fx.fx.data as T;
}

type Ctx = CanvasRenderingContext2D;

// ---------- Word wave: a wall of rows waving like cloth ----------

function wave(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const rows = Math.round(5 + fx.density * 5);
  const rowH = (env.height / rows) * fx.size;
  const px = rowH * 0.9;
  const made = cached(fx, env, 'wave', `${Math.round(W)}`, () => {
    const colours = palette(fx, env);
    const text = `${wordsOf(fx, env).join('\u2002')}\u2002`;
    const base: Look = { colours, glow: fx.glow, tile: true, cyclic: true };
    const fill = lineSprite(env, text, px, fx.font, base);
    const line =
      fx.style === 'fill' ? fill : lineSprite(env, text, px, fx.font, { ...base, outline: true });
    return { fill, line };
  });
  const count = Math.ceil(H / rowH) + 4;
  const top = (H - count * rowH) / 2;
  // The cloth: how far a point of the wall is moved up or down — two long slow waves
  // crossing each other, so the rows bend, swell and thin like a flag in a light wind.
  const amp = rowH * (0.35 + fx.chaos * 1.1);
  const kx = TAU / Math.max(env.width, 1);
  const ky = TAU / Math.max(env.height, 1);
  const lift = (x: number, y: number) =>
    amp *
    (0.6 * Math.sin(x * kx * 1.15 + y * ky * 0.7 + t * 0.55) +
      0.4 * Math.sin(x * kx * 0.55 - y * ky * 1.25 - t * 0.38 + 1.7));
  const slices = clamp(Math.round(W / 13), 14, 44);
  const dx = W / slices;
  for (let r = 0; r < count; r++) {
    const outline = fx.style === 'outline' || (fx.style === 'mix' && r % 2 === 1);
    const s = outline ? made.line : made.fill;
    const copy = s.tw;
    // A few rows stand out, the rest stay back.
    const rowA = r % 4 === 1 ? 1 : 0.4;
    const pace = 0.8 + ((r * 37) % 10) / 30;
    const dir = fx.flow === 'alt' && r % 2 ? -1 : 1;
    const moved = fx.flow === 'still' ? 0 : t * px * 0.22 * pace * dir;
    const start = (((moved + r * px * 1.9) % copy) + copy) % copy;
    const y0 = top + r * rowH;
    const q = s.c.width / s.w;
    for (let i = 0; i < slices; i++) {
      const x = i * dx;
      const a0 = y0 + lift(x, y0);
      const a1 = y0 + lift(x + dx, y0);
      const b0 = y0 + rowH + lift(x, y0 + rowH);
      const b1 = y0 + rowH + lift(x + dx, y0 + rowH);
      const h = (b0 - a0 + b1 - a1) / 2;
      if (h < rowH * 0.12) continue;
      // Lit where the cloth swells towards the viewer, dim where it folds away.
      const light = clamp(0.45 + 0.55 * (h / rowH), 0.25, 1.15);
      ctx.globalAlpha = Math.min(1, env.alpha * rowA * light);
      // The slice of the row as a slanted box: its left edge at a0, its right at a1.
      let sx = (start + x) % copy;
      let done = 0;
      while (done < dx - 0.01) {
        const part = Math.min(dx - done, copy - sx);
        const slope = (a1 - a0) / dx;
        ctx.save();
        ctx.transform(1, slope, 0, h / rowH, x + done, a0 + slope * done);
        ctx.drawImage(
          s.c,
          sx * q,
          0,
          Math.min(part + 0.75, copy - sx) * q,
          s.c.height,
          0,
          -s.pad - (s.h - s.pad * 2 - rowH) / 2,
          Math.min(part + 0.75, copy - sx),
          s.h,
        );
        ctx.restore();
        done += part;
        sx = 0;
      }
    }
  }
}

// ---------- Word tunnel: rings of text coming out of the depth ----------

function tunnel(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const far = Math.hypot(env.width, env.height) * 0.62;
  const made = cached(fx, env, 'tunnel', '', () => {
    const radius = Math.min(far, 560 / env.ratio);
    const px = radius * 0.2 * fx.size;
    const text = `${wordsOf(fx, env).join('\u2002')}\u2002`;
    const look: Look = { colours: palette(fx, env), glow: fx.glow };
    const fill = ringSprite(env, text, px, radius, fx.font, look);
    const line =
      fx.style === 'fill'
        ? fill
        : ringSprite(env, text, px, radius, fx.font, { ...look, outline: true });
    return { fill, line, radius };
  });
  const rings = Math.round(4 + fx.density * 4);
  // Each ring's radius grows by the same share every moment (so the text keeps its place in
  // the perspective); 30 times from the far end to past the corners.
  const reach = 30;
  const order = Array.from({ length: rings }, (_, i) => i).sort(
    (a, b) => frac(t * 0.06 + a / rings) - frac(t * 0.06 + b / rings),
  );
  for (const i of order) {
    const p = frac(t * 0.06 + i / rings);
    const r = (far / reach) * Math.pow(reach, p) * 1.25;
    const outline = fx.style === 'outline' || (fx.style === 'mix' && i % 2 === 1);
    const s = outline ? made.line : made.fill;
    const k = r / made.radius;
    const alpha = smooth(0, 0.22, p) * (1 - smooth(0.82, 1, p)) * (0.35 + 0.65 * p);
    if (alpha < 0.01) continue;
    const dir = fx.flow === 'still' ? 0 : fx.flow === 'alt' && i % 2 ? -1 : 1;
    // The far rings sway a little off the middle: the tunnel bends as it goes.
    const sway = (1 - p) * fx.chaos * Math.min(env.width, env.height) * 0.16;
    const cx = W / 2 + Math.sin(t * 0.4 + (1 - p) * 3) * sway;
    const cy = H / 2 + Math.cos(t * 0.31 + (1 - p) * 2.4) * sway;
    ctx.save();
    ctx.globalAlpha = env.alpha * alpha;
    ctx.translate(cx, cy);
    ctx.rotate(dir * t * 0.12 + i * 1.3);
    ctx.drawImage(s.c, (-s.w / 2) * k, (-s.h / 2) * k, s.w * k, s.h * k);
    ctx.restore();
  }
}

// ---------- Word ring: the words running round circles, like a badge ----------

function ring(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const m = Math.min(env.width, env.height);
  const made = cached(fx, env, 'ring', '', () => {
    const px = m * 0.085 * fx.size;
    const text = `${wordsOf(fx, env).join(' • ')} • `;
    const look: Look = { colours: palette(fx, env), glow: fx.glow };
    const count = clamp(Math.round(fx.density * 2), 1, 6);
    const out: Sprite[] = [];
    let radius = m * 0.45 - px * 0.6;
    for (let i = 0; i < count && radius > px * 1.2; i++) {
      const outline = fx.style === 'outline' || (fx.style === 'mix' && i % 2 === 1);
      out.push(ringSprite(env, text, px, radius, fx.font, { ...look, outline }));
      radius -= px * 1.5;
    }
    return out;
  });
  made.forEach((s, i) => {
    const dir = fx.flow === 'still' ? 0 : fx.flow === 'alt' && i % 2 ? -1 : 1;
    // Inner rings turn a little faster, as the same speed along a shorter way round.
    const turn = dir * t * 0.2 * (1 + i * 0.25) + i * 0.9;
    const breathe = 1 + 0.018 * Math.sin(t * 0.8 + i * 1.1);
    ctx.save();
    ctx.globalAlpha = env.alpha * (1 - i * 0.12);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(turn);
    ctx.scale(breathe, breathe);
    ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h);
    ctx.restore();
  });
}

// ---------- Word echo: one big word with outlines stacked above and below ----------

function echo(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = cached(fx, env, 'echo', '', () => {
    const words = wordsOf(fx, env);
    const colours = palette(fx, env);
    let px = env.height * 0.16 * fx.size;
    // As big as asked, but the longest word still fits across.
    for (const w of words) {
      const tw = widthOf(fontOf(px, fx.font), w);
      if (tw > env.width * 0.88) px *= (env.width * 0.88) / tw;
    }
    const look: Look = { colours, glow: fx.glow };
    return {
      px,
      words: words.map((w) => ({
        fill: lineSprite(env, w, px, fx.font, look),
        line: lineSprite(env, w, px, fx.font, { ...look, outline: true }),
      })),
    };
  });
  const each = 3.6;
  const n = made.words.length;
  const at = t / each;
  const idx = ((Math.floor(at) % n) + n) % n;
  const u = frac(at);
  const count = clamp(Math.round(1 + fx.density * 2.6), 1, 9);
  const gap = made.px * 0.8 * (1 + 0.07 * Math.sin(t * 0.9));
  const flow = fx.flow === 'still' ? 0 : frac(t * 0.2);
  const stack = (word: (typeof made.words)[number], alpha: number, grow: number) => {
    if (alpha <= 0.01) return;
    const put = (s: Sprite, y: number, a: number) => {
      ctx.globalAlpha = env.alpha * alpha * a;
      ctx.drawImage(
        s.c,
        W / 2 - (s.w / 2) * grow,
        H / 2 + y - (s.h / 2) * grow,
        s.w * grow,
        s.h * grow,
      );
    };
    // The echoes drift outwards and fade, each taking the next one's place.
    for (let i = count - 1; i >= 0; i--) {
      const d = i + flow;
      const a = Math.pow(1 - d / (count + 0.001), 1.5) * smooth(0.05, 0.6, d);
      const filled = fx.style === 'mix' && i % 2 === 1;
      const s = filled ? word.fill : word.line;
      const dim = filled ? 0.35 : 0.9;
      put(s, -d * gap, a * dim);
      put(s, d * gap, a * dim);
    }
    put(fx.style === 'outline' ? word.line : word.fill, 0, 1);
  };
  // Several words take turns: the one leaving swells and fades as the next settles in.
  const turn = n > 1 ? smooth(0.86, 1, u) : 0;
  stack(made.words[idx]!, 1 - turn, 1 + turn * 0.12);
  if (turn > 0) stack(made.words[(idx + 1) % n]!, turn, 0.9 + turn * 0.1);
}

// ---------- Word tapes: bold strips crossing the block, words running along them ----------

/** Where each tape lies: its slant in degrees and how far from the middle (in block heights). */
const TAPES: readonly (readonly [number, number])[] = [
  [-13, -0.04],
  [9, 0.06],
  [-4, 0.33],
  [5, -0.34],
  [17, -0.2],
  [-20, 0.2],
];

function marquee(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const m = Math.min(env.width, env.height);
  const th = m * 0.135 * fx.size;
  const count = clamp(Math.round(1 + fx.density * 1.6), 1, TAPES.length);
  const made = cached(fx, env, 'marquee', '', () => {
    const colours = palette(fx, env);
    const px = th * 0.62;
    const text = `${wordsOf(fx, env).join(' • ')} • `;
    return Array.from({ length: count }, (_, i) => {
      const colour = along(colours, count > 1 ? i / (count - 1) : 0);
      const dark = fx.style === 'outline' || (fx.style === 'mix' && i % 2 === 1);
      // A filled tape: the colour with dark or white letters, whichever reads; a dark tape:
      // outlined letters in the colour.
      const ink: RGB = dark ? colour : luminance(colour) > 0.6 ? [16, 16, 20] : [255, 255, 255];
      const words = lineSprite(env, text, px, fx.font, {
        colours: [ink],
        outline: dark,
        glow: dark ? fx.glow : 0,
        tile: true,
      });
      const q = words.c.width / words.w;
      const c = document.createElement('canvas');
      c.width = words.c.width;
      c.height = Math.max(1, Math.round(th * q));
      const g = c.getContext('2d')!;
      g.fillStyle = dark ? 'rgba(14,14,18,0.92)' : css(colour);
      g.fillRect(0, 0, c.width, c.height);
      // Thin lines along the edges, as on printed tape.
      g.fillStyle = css(dark ? colour : ink, dark ? 0.9 : 0.55);
      const edge = Math.max(1, Math.round(th * 0.035 * q));
      g.fillRect(0, Math.round(th * 0.09 * q), c.width, edge);
      g.fillRect(0, c.height - Math.round(th * 0.09 * q) - edge, c.width, edge);
      g.drawImage(words.c, 0, Math.round((c.height - words.c.height) / 2));
      return { c, copy: words.tw };
    });
  });
  const span = Math.hypot(W, H) * 1.1;
  made.forEach((tape, i) => {
    const [deg, off] = TAPES[i]!;
    const dir = fx.flow === 'still' ? 0 : fx.flow === 'alt' && i % 2 ? -1 : 1;
    const moved = dir * t * th * 0.5 * (0.85 + ((i * 37) % 10) / 30) + i * th * 2.3;
    const start = -((((moved % tape.copy) + tape.copy) % tape.copy) + span / 2);
    ctx.save();
    ctx.translate(W / 2, H / 2 + off * env.height);
    ctx.rotate((deg * Math.PI) / 180);
    // A soft shadow under the tape lifts it off the ones it crosses.
    ctx.globalAlpha = env.alpha * 0.28;
    ctx.fillStyle = '#000';
    ctx.fillRect(-span / 2, -th / 2 + th * 0.09, span, th);
    ctx.globalAlpha = env.alpha;
    for (let x = start; x < span / 2; x += tape.copy)
      ctx.drawImage(tape.c, x, -th / 2, tape.copy + 0.5, th);
    ctx.restore();
  });
}

// ---------- Glitch text: a title with split colours and bursts of torn slices ----------

function glitch(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = cached(fx, env, 'glitch', '', () => {
    const words = wordsOf(fx, env);
    // Up to four lines: a word a line, more words share the lines.
    const lines: string[] = [];
    const per = Math.ceil(words.length / 4);
    for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(' '));
    let px = Math.min(env.height * 0.2 * fx.size, (env.height * 0.8) / lines.length);
    for (const l of lines) {
      const tw = widthOf(fontOf(px, fx.font), l);
      if (tw > env.width * 0.84) px *= (env.width * 0.84) / tw;
    }
    const own = fx.colors?.map(rgbOf).filter((c): c is RGB => !!c) ?? [];
    const main: RGB = own[0] ?? [255, 255, 255];
    const tints: RGB[] = [own[1] ?? [0, 229, 255], own[2] ?? [255, 42, 109]];
    const lineH = px * 0.98;
    const title = (colour: RGB, glow: number): Sprite => {
      const rows = lines.map((l) =>
        lineSprite(env, l, px, fx.font, {
          colours: [colour],
          outline: fx.style === 'outline',
          glow,
        }),
      );
      const w = Math.max(...rows.map((r) => r.w));
      const h = lineH * (lines.length - 1) + rows[0]!.h;
      const q = rows[0]!.c.width / rows[0]!.w;
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * q);
      c.height = Math.ceil(h * q);
      const g = c.getContext('2d')!;
      rows.forEach((r, i) =>
        g.drawImage(r.c, Math.round(((w - r.w) / 2) * q), Math.round(i * lineH * q)),
      );
      return { c, w, h, pad: rows[0]!.pad, tw: w };
    };
    return {
      px,
      main: title(main, fx.glow),
      a: title(tints[0]!, 0),
      b: title(tints[1]!, 0),
      tints,
    };
  });
  const { px, main, a, b } = made;
  const x0 = W / 2 - main.w / 2;
  const y0 = H / 2 - main.h / 2;
  const q = main.c.width / main.w;
  // Bursts: now and then, for a third of a second, the title tears into shifted slices.
  const every = 2.8 / (0.5 + fx.chaos);
  const k = Math.floor(t / every);
  const u = t / every - k;
  const from = 0.1 + 0.6 * hash(k * 1.7 + fx.seed);
  const len = 0.36 / every;
  const burst = u > from && u < from + len ? Math.sin(((u - from) / len) * Math.PI) : 0;
  // The tear changes 14 times a second and holds between — jumpy, as a glitch is.
  const tick = Math.floor(t * 14);
  const split = px * (0.018 + 0.008 * Math.sin(t * 1.3)) + burst * px * 0.07;
  const band = (top: number, h: number, dx: number, extra: number) => {
    const sy = top * q;
    const sh = Math.min(h * q, main.c.height - sy);
    if (sh <= 0) return;
    const draw = (s: Sprite, ox: number, oy: number, alpha: number) => {
      ctx.globalAlpha = env.alpha * alpha;
      ctx.drawImage(s.c, 0, sy, s.c.width, sh, x0 + dx + ox, y0 + top + oy, s.w, sh / q);
    };
    draw(a, -(split + extra), -split * 0.25, 0.85);
    draw(b, split + extra, split * 0.25, 0.85);
    draw(main, 0, 0, 1);
  };
  if (burst <= 0) {
    // Calm: the whole title with its colours a little apart — and, rarely, one slice slips.
    const slip = hash(Math.floor(t * 2.5) * 3.1 + fx.seed) > 0.86 && frac(t * 2.5) < 0.22;
    if (!slip) band(0, main.h, 0, 0);
    else {
      const at = main.h * (0.15 + 0.6 * hash(tick * 0.37 + fx.seed));
      const h = px * 0.22;
      band(0, at, 0, 0);
      band(at, h, px * 0.12 * (hash(tick + 5) - 0.5) * 2, px * 0.03);
      band(at + h, main.h - at - h, 0, 0);
    }
  } else {
    const parts = Math.round(4 + fx.density * 4);
    let top = 0;
    for (let i = 0; i < parts; i++) {
      const share = 0.5 + hash(k * 9.1 + i * 3.3 + tick * 0.71 + fx.seed);
      const h = i === parts - 1 ? main.h - top : Math.min(main.h - top, (main.h / parts) * share);
      const torn = hash(tick * 1.31 + i * 7.7 + fx.seed) > 0.5;
      const dx = torn ? (hash(tick * 2.17 + i * 5.1) - 0.5) * px * 0.9 * burst : 0;
      band(top, h, dx, torn ? px * 0.05 * burst : 0);
      top += h;
    }
    // A couple of thin bright bars flick across, as on a torn picture.
    for (let i = 0; i < 2; i++) {
      const r = hash(tick * 3.3 + i * 11.1 + fx.seed);
      ctx.globalAlpha = env.alpha * 0.8 * burst;
      ctx.fillStyle = css(made.tints[i]!);
      ctx.fillRect(
        x0 + main.w * (r * 0.7 - 0.05),
        y0 + main.h * hash(tick * 1.9 + i * 4.3),
        main.w * (0.12 + 0.3 * hash(tick + i)),
        Math.max(1, px * 0.035),
      );
    }
  }
}

// ---------- Word rain: words falling at different depths ----------

/** The depths: letter size, how clearly seen, how fast, how out of focus. */
const DEPTHS = [
  { size: 0.5, alpha: 0.38, pace: 0.55, soft: 1 },
  { size: 0.95, alpha: 0.9, pace: 1, soft: 1 },
  { size: 2.1, alpha: 0.5, pace: 1.8, soft: 0.16 },
] as const;

function rain(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const m = Math.min(env.width, env.height);
  const base = m * 0.1 * fx.size;
  const made = cached(fx, env, 'rain', '', () => {
    const words = wordsOf(fx, env);
    const colours = palette(fx, env);
    return words.map((w, i) => {
      const colour = along(colours, words.length > 1 ? i / (words.length - 1) : 0.5);
      return DEPTHS.map((d, j) =>
        lineSprite(env, w, base * d.size, fx.font, {
          // Near words in a paler shade of the colour, far ones in the colour itself.
          colours: [j === 2 ? (along([colour, [255, 255, 255]], 0.35) as RGB) : colour],
          outline: fx.style === 'outline' || (fx.style === 'mix' && j === 1 && i % 2 === 1),
          glow: j === 1 ? fx.glow : 0,
          soft: d.soft,
        }),
      );
    });
  });
  const count = Math.round(6 + fx.density * 12);
  const columns = Math.max(4, Math.round(count * 0.75));
  // Far words first, the near blurred ones over them.
  for (let depth = 0; depth < 3; depth++)
    for (let i = 0; i < count; i++) {
      const z = hash(i * 3.17 + fx.seed * 1.3);
      const which = z < 0.45 ? 0 : z < 0.86 ? 1 : 2;
      if (which !== depth) continue;
      const d = DEPTHS[which]!;
      const s = made[i % made.length]![which]!;
      const column = Math.floor(hash(i * 7.31 + fx.seed) * columns);
      const x = ((column + 0.5) / columns) * W;
      // The word falls from just above the block to just under it, then comes round again.
      const way = H + s.w;
      const pace = base * 1.5 * d.pace * (0.8 + 0.4 * hash(i * 1.93));
      const y = -s.w / 2 + frac((t * pace) / way + hash(i * 5.7 + fx.seed)) * way;
      ctx.save();
      ctx.globalAlpha = env.alpha * d.alpha;
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h);
      ctx.restore();
    }
}

// ---------- Kinetic type: one word at a time, as motion designers set titles ----------

/** The words sized to fit across, each as one picture and as its letters (with places). */
function titleSet(fx: TextFx, env: TextEnv, kind: string, scale = 0.2) {
  return cached(fx, env, kind, '', () => {
    const words = wordsOf(fx, env);
    const colours = palette(fx, env);
    let px = env.height * scale * fx.size;
    for (const w of words) {
      const tw = widthOf(fontOf(px, fx.font), w);
      if (tw > env.width * 0.86) px *= (env.width * 0.86) / tw;
    }
    const font = fontOf(px, fx.font);
    const look: Look = { colours, glow: fx.glow, outline: fx.style === 'outline' };
    return {
      px,
      words: words.map((w, wi) => {
        const chars = [...w];
        const total = widthOf(font, w);
        let x = -total / 2;
        const letters = chars.map((ch, i) => {
          const cw = widthOf(font, ch);
          const colour = along(colours, chars.length > 1 ? i / (chars.length - 1) : 0.5);
          const s = lineSprite(env, ch, px, fx.font, {
            ...look,
            colours: [colour],
            outline: fx.style === 'outline' || (fx.style === 'mix' && wi % 2 === 1),
          });
          const at = x + cw / 2;
          x += cw;
          return { s, x: at, blank: ch.trim() === '' };
        });
        return { whole: lineSprite(env, w, px, fx.font, look), letters, total };
      }),
    };
  });
}

/** Which word is on, and how far into its turn (0…1), each word on for `each` seconds. */
function turnOf(t: number, n: number, each: number) {
  const at = t / each;
  return { i: ((Math.floor(at) % n) + n) % n, u: frac(at) };
}

/** A letter's picture drawn round its own middle, moved, turned and sized. */
function putLetter(
  ctx: Ctx,
  s: Sprite,
  x: number,
  y: number,
  alpha: number,
  scale = 1,
  rot = 0,
  sy = 1,
) {
  if (alpha <= 0.01 || scale <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(scale, scale * sy);
  ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h);
  ctx.restore();
}

// Typewriter: the word typed letter by letter behind a blinking cursor, held, then taken back.
function typewriter(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = titleSet(fx, env, 'type');
  const each = 4.2;
  const { i, u } = turnOf(t, made.words.length, each);
  const word = made.words[i]!;
  const n = word.letters.length;
  // Typing in the first 45 %, held, taken back in the last 18 %.
  const shown = u < 0.45 ? (u / 0.45) * n : u < 0.82 ? n : (1 - (u - 0.82) / 0.18) * n;
  const count = Math.floor(clamp(shown, 0, n));
  const cy = H / 2;
  word.letters.forEach((l, k) => {
    if (k < count) putLetter(ctx, l.s, W / 2 + l.x, cy, env.alpha);
  });
  // The cursor sits after the last letter typed and blinks while waiting.
  const last = count > 0 ? word.letters[count - 1]! : null;
  const cx = W / 2 + (last ? last.x + last.s.tw / 2 : -word.total / 2) + made.px * 0.08;
  const typing = u < 0.45 || u > 0.82;
  if (typing || frac(t * 1.6) < 0.55) {
    ctx.globalAlpha = env.alpha;
    ctx.fillStyle = css(palette(fx, env)[0]!);
    ctx.fillRect(cx, cy - made.px * 0.45, Math.max(2, made.px * 0.07), made.px * 0.9);
  }
}

// Pop: each word springs up from nothing with a bounce, holds, then flies off upward.
function pop(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = titleSet(fx, env, 'pop');
  const each = 2.6;
  const { i, u } = turnOf(t, made.words.length, each);
  const word = made.words[i]!;
  const n = word.letters.length;
  word.letters.forEach((l, k) => {
    // Letters come in one after another.
    const start = (k / Math.max(1, n)) * 0.22;
    const v = clamp((u - start) / 0.3, 0, 1);
    // An elastic spring: past the size, back under it, settling.
    const spring = v >= 1 ? 1 : 1 - Math.cos(v * Math.PI * 2.5) * Math.exp(-v * 5.5);
    const leave = smooth(0.8, 1, u);
    const y = H / 2 - leave * H * 0.35 + (1 - Math.min(1, v * 1.4)) * made.px * 0.3;
    putLetter(ctx, l.s, W / 2 + l.x, y, env.alpha * (1 - leave), spring * (1 - leave * 0.3));
  });
}

// Flip: letters turn over into place one after another, like a departures board.
function flip(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = titleSet(fx, env, 'flip');
  const each = 3.4;
  const { i, u } = turnOf(t, made.words.length, each);
  const word = made.words[i]!;
  const n = word.letters.length;
  word.letters.forEach((l, k) => {
    const a = clamp((u - (k / Math.max(1, n)) * 0.3) / 0.18, 0, 1);
    const b = clamp((u - 0.82 - (k / Math.max(1, n)) * 0.12) / 0.06, 0, 1);
    // Squeezed flat at the turn, full height once over.
    const sy = a < 1 ? Math.abs(Math.cos(a * Math.PI)) : 1 - b;
    const shade = a < 0.5 ? 0.55 : 1;
    putLetter(
      ctx,
      l.s,
      W / 2 + l.x,
      H / 2,
      env.alpha * shade * (a > 0 ? 1 : 0),
      1,
      0,
      Math.max(0.02, sy),
    );
  });
}

// Assemble: the letters fly in from all sides, turning, to make the word, then scatter.
function assemble(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = titleSet(fx, env, 'assemble');
  const each = 4;
  const { i, u } = turnOf(t, made.words.length, each);
  const word = made.words[i]!;
  const k0 = Math.floor(t / each);
  word.letters.forEach((l, k) => {
    const h1 = hash(k * 3.1 + k0 * 7.7 + fx.seed);
    const h2 = hash(k * 5.3 + k0 * 1.9 + fx.seed);
    const ang = h1 * TAU;
    const far = Math.max(W, H) * (0.55 + 0.35 * h2);
    const come = 1 - Math.pow(1 - clamp(u / 0.42, 0, 1), 3);
    const go = Math.pow(clamp((u - 0.8) / 0.2, 0, 1), 2);
    const away = 1 - come + go;
    const x = W / 2 + l.x + Math.cos(ang) * far * away;
    const y = H / 2 + Math.sin(ang) * far * away;
    const rot = (h2 - 0.5) * 4 * away * (0.5 + fx.chaos);
    putLetter(ctx, l.s, x, y, env.alpha * clamp(come * 1.4, 0, 1) * (1 - go), 1 + away * 0.6, rot);
  });
}

// Neon sign: the word lit as a tube that buzzes; now and then letters stutter off and on.
function neon(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = cached(fx, env, 'neon', '', () => {
    const base = titleSet({ ...fx, fx: undefined, glow: Math.max(1, fx.glow) }, env, 'neonset');
    return base;
  });
  const each = 5;
  const { i } = turnOf(t, made.words.length, each);
  const word = made.words[i]!;
  const tick = Math.floor(t * 18);
  const hum = 0.88 + 0.12 * Math.sin(t * 40) * Math.sin(t * 3.1);
  word.letters.forEach((l, k) => {
    // A faulty letter or two: dark for a few flickers now and then.
    const bad = hash(k * 1.7 + fx.seed) > 0.75;
    const off = bad && hash(tick * 0.61 + k * 9.3) > 0.72 - 0.25 * fx.chaos;
    const a = off ? 0.12 : hum;
    putLetter(ctx, l.s, W / 2 + l.x, H / 2, env.alpha * a);
  });
}

// Zoom through: each word rushes in from far away, passes the viewer and is gone.
function zoomThrough(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = titleSet(fx, env, 'zoom');
  const each = 2.2;
  const { i, u } = turnOf(t, made.words.length, each);
  const s = made.words[i]!.whole;
  // Slow in the middle (readable), fast at both ends: from a sixteenth of its size to
  // sixteen times it, passing its own size half way.
  const e = u < 0.5 ? 0.5 - Math.pow(1 - 2 * u, 3) / 2 : 0.5 + Math.pow(2 * u - 1, 3) / 2;
  const scale = Math.pow(16, e * 2 - 1);
  const alpha = smooth(0, 0.18, u) * (1 - smooth(0.82, 1, u));
  // A trail of fainter copies behind it, as motion blur.
  for (let k = 3; k >= 0; k--) {
    const sk = scale * (1 - k * 0.06);
    putLetter(ctx, s, W / 2, H / 2, env.alpha * alpha * (k === 0 ? 1 : 0.18), sk);
  }
}

// Roll: the words roll by in a window like a slot machine, settling on each in turn.
function roll(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = titleSet(fx, env, 'roll');
  const n = made.words.length;
  const each = 2;
  const at = t / each;
  const k = Math.floor(at);
  const u = frac(at);
  // Moves in the first 35 % of each turn with a small overshoot, then stands.
  const v = clamp(u / 0.35, 0, 1);
  const ease = v >= 1 ? 1 : 1 - Math.pow(1 - v, 3) + Math.sin(v * Math.PI) * 0.12;
  const pos = k + ease;
  const gap = made.px * 1.25;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, H / 2 - gap * 1.1, W, gap * 2.2);
  ctx.clip();
  for (let j = Math.floor(pos) - 1; j <= Math.floor(pos) + 2; j++) {
    const s = made.words[((j % n) + n) % n]!.whole;
    const y = H / 2 + (j - pos) * gap;
    const a = 1 - clamp(Math.abs(j - pos), 0, 1) * 0.8;
    putLetter(ctx, s, W / 2, y, env.alpha * a, 1, 0, 1 - clamp(Math.abs(j - pos), 0, 1) * 0.3);
  }
  ctx.restore();
}

// Shine: the title floats gently while a band of light sweeps across its letters.
function shine(ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) {
  const made = titleSet(fx, env, 'shine', 0.22);
  const each = 4.5;
  const { i, u } = turnOf(t, made.words.length, each);
  const s = made.words[i]!.whole;
  const fade = smooth(0, 0.12, u) * (1 - smooth(0.88, 1, u));
  const y = H / 2 + Math.sin(t * 0.9) * made.px * 0.06;
  putLetter(ctx, s, W / 2, y, env.alpha * fade);
  // The light: the word again, lit white, seen only in a slanted band moving across.
  const band = (frac(t / 2.6) * 1.6 - 0.3) * s.w;
  ctx.save();
  ctx.beginPath();
  const x0 = W / 2 - s.w / 2 + band;
  ctx.moveTo(x0, y - s.h);
  ctx.lineTo(x0 + s.h * 0.35, y - s.h);
  ctx.lineTo(x0 + s.h * 0.35 - s.h * 0.6, y + s.h);
  ctx.lineTo(x0 - s.h * 0.6, y + s.h);
  ctx.closePath();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  putLetter(ctx, s, W / 2, y, env.alpha * fade * 0.85);
  ctx.restore();
}

/** The text effects by kind (the word wall keeps its own drawing in ParticleCanvas). */
const DRAW: Partial<
  Record<
    MeetingMotion,
    (ctx: Ctx, fx: TextFx, env: TextEnv, t: number, W: number, H: number) => void
  >
> = {
  wordwave: wave,
  wordtunnel: tunnel,
  wordring: ring,
  wordecho: echo,
  wordmarquee: marquee,
  wordglitch: glitch,
  wordrain: rain,
  wordtype: typewriter,
  wordpop: pop,
  wordflip: flip,
  wordassemble: assemble,
  wordneon: neon,
  wordzoom: zoomThrough,
  wordroll: roll,
  wordshine: shine,
};

/** Draws one frame of a text effect into the area W × H; false when the kind is not one. */
export function drawTextFx(
  ctx: Ctx,
  kind: MeetingMotion,
  fx: TextFx,
  env: TextEnv,
  time: number,
  W: number,
  H: number,
): boolean {
  const draw = DRAW[kind];
  if (!draw) return false;
  ctx.save();
  draw(ctx, fx, env, time, W, H);
  ctx.restore();
  return true;
}
