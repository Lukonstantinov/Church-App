import type { MotionLayer, MotionTune, PosterBackground, PosterLayer } from '@church/shared';

/**
 * Colour variants of a design (the poster maker's «🎨 Colour variants»): every colour in it
 * turned the same way round the colour wheel, so the variant keeps the original's light and
 * dark, its contrasts and how its colours stand to each other — the same design in another
 * colouring. Whites, blacks and greys have no colour to turn and stay as they are.
 */

type Hsl = [h: number, s: number, l: number];

function toHsl(hex: string): Hsl {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const turn = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/** A colour turned `deg` degrees round the colour wheel (light and strength kept). */
export function shiftHex(hex: string, deg: number): string {
  if (!turn(deg)) return hex;
  const [h, s, l] = toHsl(hex);
  return s === 0 ? hex : fromHsl([(h + turn(deg)) % 360, s, l]);
}

/** How far round the wheel `to` is from `from`, in degrees (0…359). */
export const hueBetween = (from: string, to: string) => turn(toHsl(to)[0] - toHsl(from)[0]);

/**
 * The design's main colour: the one that counts most among `colours` — strong colours of
 * middle lightness over pale, dark and grey ones, earlier ones (the background) over later.
 */
export function mainColour(colours: readonly string[]): string | null {
  let best: string | null = null;
  let top = 0;
  colours.forEach((c, i) => {
    const [, s, l] = toHsl(c);
    const weight = s * (1 - Math.abs(2 * l - 1)) * (1 + 1 / (i + 1));
    if (weight > top + 1e-6) {
      top = weight;
      best = c;
    }
  });
  return best;
}

const opt = (c: string | null | undefined, deg: number) => (c ? shiftHex(c, deg) : c);

function tuneWith(tune: MotionTune | null | undefined, deg: number) {
  if (!tune || (!tune.color && !tune.colors && !tune.bg)) return tune;
  return {
    ...tune,
    color: opt(tune.color, deg),
    colors: tune.colors?.map((c) => shiftHex(c, deg)),
    bg: opt(tune.bg, deg),
  };
}

/** Effects with their own colours turned (those in the ministry's colour follow `--brand`). */
export function recolourEffects<T extends MotionLayer>(layers: T[], deg: number): T[] {
  if (!turn(deg)) return layers;
  return layers.map((l) => ({ ...l, tune: tuneWith(l.tune, deg) ?? null }));
}

/**
 * Poster layers in the variant's colours: colour layers, texts, glows and outlines, and
 * effects' own colours. With `pictures`, photos and cut-outs are turned too (through the
 * layer's hue adjustment, which the recorder draws as well).
 */
export function recolourLayers(
  layers: PosterLayer[],
  deg: number,
  pictures = false,
): PosterLayer[] {
  if (!turn(deg)) return layers;
  return layers.map((l): PosterLayer => {
    const effects = 'effects' in l && l.effects ? recolourEffects(l.effects, deg) : undefined;
    const style =
      'style' in l && l.style
        ? { ...l.style, glow: opt(l.style.glow, deg), stroke: opt(l.style.stroke, deg) }
        : undefined;
    switch (l.type) {
      case 'fill':
        return { ...l, colors: l.colors.map((c) => shiftHex(c, deg)), effects };
      case 'text':
        return { ...l, color: opt(l.color, deg), style, effects };
      case 'effect':
        return { ...l, tune: tuneWith(l.tune, deg) };
      case 'image': {
        if (!pictures) return { ...l, style, effects };
        // Kept within −180…180, as the layer's hue slider has it.
        const hue = ((((l.adjust?.hue ?? 0) + turn(deg) + 180) % 360) + 360) % 360;
        return { ...l, style, effects, adjust: { ...l.adjust, hue: hue - 180 } };
      }
    }
  });
}

export function recolourBackground(bg: PosterBackground, deg: number): PosterBackground {
  return { ...bg, colors: bg.colors.map((c) => shiftHex(c, deg)) };
}

/** A whole poster design (background, layers, frame) in the variant's colours. */
export function recolourDoc<
  T extends {
    background: PosterBackground;
    layers: PosterLayer[];
    frame?: { color: string; glow?: string | null } | null;
  },
>(doc: T, deg: number, pictures = false): T {
  if (!turn(deg)) return doc;
  return {
    ...doc,
    background: recolourBackground(doc.background, deg),
    layers: recolourLayers(doc.layers, deg, pictures),
    frame: doc.frame
      ? { ...doc.frame, color: shiftHex(doc.frame.color, deg), glow: opt(doc.frame.glow, deg) }
      : doc.frame,
  };
}

/** Every colour a design is made of, the background's first (for `mainColour`). */
export function designColours(
  doc: { background: PosterBackground; layers: readonly PosterLayer[] } | null,
  effects: readonly MotionLayer[] = [],
): string[] {
  const out: string[] = [];
  const ofTune = (t: MotionTune | null | undefined) => {
    if (t?.colors) out.push(...t.colors);
    if (t?.color) out.push(t.color);
  };
  if (doc) {
    if (doc.background.type === 'color' || doc.background.type === 'gradient')
      out.push(...doc.background.colors);
    for (const l of doc.layers) {
      if (l.hidden) continue;
      if (l.type === 'fill') out.push(...l.colors);
      else if (l.type === 'text' && l.color) out.push(l.color);
      else if (l.type === 'effect') ofTune(l.tune);
      if ('effects' in l) l.effects?.forEach((e) => ofTune(e.tune));
    }
  }
  effects.forEach((e) => ofTune(e.tune));
  return out;
}
