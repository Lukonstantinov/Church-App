import type { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { holdGpu, seekGpu } from '../components/GpuEffect';
import { holdParticles, seekParticles } from '../components/ParticleCanvas';
import { holdShaders, seekShaders } from '../components/ShaderEffect';
import { boxIn, drawFitted, drawShot, freeCanvas, picturesReady } from './poster';
import { drawFlash, drawLook, transitionAt, type SlideTransition } from './slideshow';

/**
 * Records a poster (or any block) with its moving effects as a short seamless loop: an MP4
 * (plays like a GIF in Telegram and WhatsApp) and, when asked, a real GIF file.
 *
 * It works in layers, so only what moves is drawn again for every frame:
 * - the still parts below the effects (background, photos), between them and above them
 *   (texts, speaker photos, logo) are drawn once, in their order — photos by our own code,
 *   as iPhones leave big photos out of the drawing library's pictures (lib/poster.ts);
 * - each effect layer is stopped and stepped through time: its CSS animations are set to
 *   the frame's moment and drawn, particle canvases are drawn at that moment;
 * - the last moments fade into the first ones, so the loop has no visible jump.
 */

export interface RecordOptions {
  /** Length of the loop. */
  seconds?: number;
  fps?: number;
  /** Width of the video in pixels (the height follows the block's shape). */
  width?: number;
  /** Exact height in pixels (an own size); otherwise from the block's shape. */
  height?: number;
  /** Also make a GIF (fewer frames and colours). */
  gif?: boolean;
  /** Make the video too (default); off when only the GIF is wanted, which is quicker. */
  video?: boolean;
  /** Frames a second of the GIF (default 10; fewer keeps a long one small enough to play). */
  gifFps?: number;
  /** Width of the GIF in pixels (default 540). */
  gifWidth?: number;
  /** Video quality: bits per pixel per frame (0.12 for posters; less for backgrounds). */
  quality?: number;
  /**
   * Just one picture (a PNG at `width`), the effects as they are this many seconds in —
   * a still of the moving poster, no video or GIF.
   */
  still?: number;
  onProgress?: (done: number) => void;
  /** Each finished frame as it goes into the file (tests look at chosen ones). */
  onFrame?: (frame: HTMLCanvasElement, index: number) => void;
  /**
   * A slideshow (FreePoster): slides of their own layers over one moving background. The
   * recording runs the slides' lengths (`seconds`), changing into slide i with `kinds[i]`
   * over its first `change` seconds (`kinds[0]`: the last slide into the first, where the
   * loop joins). `show(slide, bare)` puts a slide on the block (null = none) — bare = only
   * its own layers, without the background — and resolves once it is laid out.
   */
  slides?: {
    seconds: number[];
    kinds: SlideTransition[];
    change: number;
    show: (slide: number | null, bare: boolean) => Promise<void>;
  };
}

export interface Recording {
  /** Null when this phone can't make videos (then only the GIF). */
  mp4: Blob | null;
  gif: Blob | null;
  /** How frames went to the video encoder here (pickFeed); null = no video. */
  feed: string | null;
  /** The still picture, when one was asked for (`still`). */
  png?: Blob | null;
}

/** Whether the block has anything moving to record. */
/** What moves: animation layers and the light passing over a part. */
const EFFECTS = '.living-clip, .shine';

export const hasEffects = (node: HTMLElement) => node.querySelector(EFFECTS) !== null;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** Hides elements for one pass; returns how to show them again. */
function hideFor(hidden: HTMLElement[]): () => void {
  const before = hidden.map((e) => e.style.visibility);
  hidden.forEach((e) => (e.style.visibility = 'hidden'));
  return () => hidden.forEach((e, i) => (e.style.visibility = before[i]!));
}

/** The topmost elements of a set (their insides go with them). */
const tops = (els: HTMLElement[]) => els.filter((e) => !els.some((o) => o !== e && o.contains(e)));

/**
 * Splits the block around its effects, keeping the order they are painted in: `bands[0]`
 * is what comes before the first effect (below it), `bands[i]` what comes after effect i
 * and before the next one — a still colour layer between two moving ones stays between
 * them. Elements holding an effect are in none (their insides are sorted instead).
 */
function layers(node: HTMLElement) {
  const effects = tops([...node.querySelectorAll<HTMLElement>(EFFECTS)]);
  const all = [...node.querySelectorAll<HTMLElement>('*')];
  const holds = (e: HTMLElement) => effects.some((x) => e.contains(x));
  const inEffect = (e: HTMLElement) => effects.some((x) => x.contains(e));
  const bands: HTMLElement[][] = effects.map(() => []);
  bands.push([]);
  const holders: HTMLElement[] = [];
  for (const e of all) {
    if (inEffect(e)) continue;
    if (holds(e)) {
      holders.push(e);
      continue;
    }
    const after = effects.filter(
      (x) => x.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).length;
    bands[after]!.push(e);
  }
  return { effects, bands: bands.map(tops), holders };
}

/**
 * A safety net for iPhones, which sometimes leave a picture out of the drawing library's
 * picture of the page: each picture of a band is looked for on the band's canvas (where the
 * picture is solid, do its own colours show?), and one that came out missing is
 * drawn by our own code in its place — without its shadow or soft edge, which is far
 * better than a cut-out logo vanishing from under its effect. Turned pictures are left as
 * they are (their box on the page isn't their own shape).
 */
function restoreMissing(
  ctx: CanvasRenderingContext2D,
  node: HTMLElement,
  pics: HTMLImageElement[],
  k: number,
) {
  const N = 48;
  const probe = canvasOf(N, N);
  const pc = probe.getContext('2d', { willReadFrequently: true })!;
  try {
    for (const img of pics) {
      if (!img.naturalWidth || !img.offsetWidth || !img.offsetHeight) continue;
      // A filtered layer (black and white, matte glass…) shows other colours on purpose.
      if (img.closest('[data-adjust]')) continue;
      const box = boxIn(node, img);
      if (box.w < 4 || box.h < 4) continue;
      if (Math.abs(box.w / box.h - img.offsetWidth / img.offsetHeight) > 0.02) continue;
      let alpha = 1;
      for (let e: HTMLElement | null = img; e && e !== node; e = e.parentElement)
        alpha *= Number.parseFloat(getComputedStyle(e).opacity) || 1;
      // A faint picture can't be told from what's under it: left as drawn.
      if (alpha < 0.6) continue;
      const css = getComputedStyle(img);
      // The picture itself, fitted into its box…
      pc.clearRect(0, 0, N, N);
      drawFitted(pc, img, 0, 0, N, N, css.objectFit, css.objectPosition);
      const want = pc.getImageData(0, 0, N, N).data;
      // …and the band's drawing there: where the picture is solid, its colours should show.
      pc.clearRect(0, 0, N, N);
      pc.drawImage(ctx.canvas, box.x * k, box.y * k, box.w * k, box.h * k, 0, 0, N, N);
      const got = pc.getImageData(0, 0, N, N).data;
      let solid = 0;
      let same = 0;
      for (let i = 0; i < want.length; i += 4) {
        if (want[i + 3]! < 250) continue;
        solid++;
        const d =
          Math.abs(want[i]! - got[i]!) +
          Math.abs(want[i + 1]! - got[i + 1]!) +
          Math.abs(want[i + 2]! - got[i + 2]!);
        if (got[i + 3]! > 200 && d < 90) same++;
      }
      if (solid < 8 || same >= solid * 0.35) continue;
      // Missing: drawn here, as see-through as the layers holding it.
      ctx.save();
      ctx.scale(k, k);
      ctx.globalAlpha = alpha;
      drawFitted(ctx, img, box.x, box.y, box.w, box.h, css.objectFit, css.objectPosition);
      ctx.restore();
    }
  } catch {
    // A canvas that can't be read here: left as drawn.
  } finally {
    freeCanvas(probe);
  }
}

/**
 * A still band kept only as big as what it holds, at its place on the frame. Full-size
 * bands (one per effect) and kept frames once added up past the memory iPhones allow all
 * canvases together, and the canvases made after that came out blank: a 2000×640 video
 * lost its background gradient, texts and sublayers while its effects stayed.
 */
interface Piece {
  pic: HTMLCanvasElement;
  x: number;
  y: number;
}

/** Whether a canvas came out fully see-through (looked at on a small copy, quickly). */
function looksBlank(c: HTMLCanvasElement): boolean {
  const N = 64;
  const probe = canvasOf(N, N);
  try {
    const p = probe.getContext('2d', { willReadFrequently: true })!;
    p.drawImage(c, 0, 0, N, N);
    const d = p.getImageData(0, 0, N, N).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) return false;
    return true;
  } catch {
    return false;
  } finally {
    freeCanvas(probe);
  }
}

/** Whether an element shows anything at all (a box with size, not hidden or see-through). */
function shows(e: HTMLElement): boolean {
  if (!e.offsetWidth || !e.offsetHeight) return false;
  const css = getComputedStyle(e);
  return css.visibility !== 'hidden' && css.display !== 'none' && Number(css.opacity) > 0.02;
}

/** The band cut to what it holds (null when it holds nothing); the full canvas is freed. */
function cropped(c: HTMLCanvasElement): Piece | null {
  const { width: w, height: h } = c;
  let data: Uint8ClampedArray;
  try {
    data = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  } catch {
    return { pic: c, x: 0, y: 0 };
  }
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++)
      if (data[row + x * 4 + 3]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  if (x1 < 0) {
    freeCanvas(c);
    return null;
  }
  // Hardly smaller: kept as it is.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > w * h * 0.8) return { pic: c, x: 0, y: 0 };
  const pic = canvasOf(x1 - x0 + 1, y1 - y0 + 1);
  pic.getContext('2d')!.drawImage(c, -x0, -y0);
  freeCanvas(c);
  return { pic, x: x0, y: y0 };
}

/** The largest picture of the page made at once (pixels): see stillParts. */
const STILL_MAX_PIXELS = 3_500_000;

/** A canvas of the block's size at the output scale. */
function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * A layer whose blend mode reaches the poster and that holds moving effects (a text set to
 * multiply, with effects in its letters): on the page its still parts and effects are put
 * together first and the whole is then blended onto what lies under it. Recorded the same
 * way — its still parts drawn on their own (`under` its first effect, `top` after it), its
 * effects added each frame, the group then blended onto the frame.
 */
interface Group {
  el: HTMLElement;
  /** Its effects (indices into the recording's effect list, in painting order). */
  fx: number[];
  under: Piece | null;
  top: Piece | null;
  blend: GlobalCompositeOperation;
  alpha: number;
}

/** The box whose blend mode reaches the poster, between an effect and the poster. */
function reachingBlend(el: HTMLElement, node: HTMLElement): HTMLElement | null {
  for (let e: HTMLElement | null = el.parentElement; e && e !== node; e = e.parentElement) {
    const mode = getComputedStyle(e).mixBlendMode;
    if (!mode || mode === 'normal') continue;
    if (blendReaches(e, node)) return e;
  }
  return null;
}

/**
 * Draws the block's still parts once, on see-through canvases at the output size: `below`
 * (background and photos), then for each effect what lies on it until the next effect
 * (null when nothing does) — the last one with the texts, speaker photos and logo. The
 * still parts of blended layers holding effects are left out of these and drawn per group.
 */
async function stillParts(node: HTMLElement, k: number, outW: number, outH: number) {
  const { toCanvas } = await import('html-to-image');
  const split = layers(node);
  const { effects, holders } = split;
  // The blended layers holding effects (the outermost of nested ones).
  const groupEls = tops(
    effects.map((e) => reachingBlend(e, node)).filter((g): g is HTMLElement => !!g),
  ).filter((g, i, all) => all.indexOf(g) === i);
  const inGroup = (e: HTMLElement) => groupEls.some((g) => g.contains(e));
  const bands = split.bands.map((b) => b.filter((e) => !inGroup(e)));
  const groupStills = groupEls.map((g) => split.bands.flat().filter((e) => g.contains(e)));
  const allGroupStills = groupStills.flat();
  const unders = [...node.querySelectorAll<HTMLElement>('[data-shot="under"]')];
  const topShots = [...node.querySelectorAll<HTMLElement>('[data-shot="top"]')];
  const W = node.offsetWidth;
  const H = node.offsetHeight;
  // The page's picture is made at most this big and then enlarged onto the frame: iPhones
  // quietly give back an empty picture when it is much larger (a 4000×1300 own size lost
  // its background gradient, texts and pictures while the effects, drawn by us, stayed).
  const pr = Math.min(k, Math.sqrt(STILL_MAX_PIXELS / Math.max(1, W * H)));
  const opts = { pixelRatio: pr, skipFonts: false, width: W, height: H } as const;
  const draw = async (ratio = pr) => {
    try {
      return await toCanvas(node, { ...opts, pixelRatio: ratio });
    } catch {
      // Embedding the fonts failed: without them.
      return toCanvas(node, { ...opts, pixelRatio: ratio, skipFonts: true });
    }
  };

  // iPhones may leave pictures out of the very first drawing of the page: one small
  // drawing, thrown away, before the ones that count (as the bot's poster pictures do).
  await toCanvas(node, { pixelRatio: 0.25, skipFonts: true, width: W, height: H })
    .then(freeCanvas)
    .catch(() => undefined);
  const below = canvasOf(outW, outH);
  const b = below.getContext('2d')!;
  // The block's own pictures (not effects' or those we draw ourselves), by band.
  const pics = [...node.querySelectorAll('img')].filter(
    (img) => !img.closest('.living-clip') && !img.closest('[data-shot]'),
  );
  const picsOf = (band: HTMLElement[]) =>
    pics.filter((img) => band.some((e) => e === img || e.contains(img)));
  let undo = hideFor([...effects, ...bands.slice(1).flat(), ...allGroupStills, ...unders]);
  try {
    let pic = await draw();
    // Out of memory, a phone gives back a blank picture: once more at half the size.
    if (looksBlank(pic)) {
      freeCanvas(pic);
      pic = await draw(pr / 2);
    }
    b.drawImage(pic, 0, 0, outW, outH);
    freeCanvas(pic);
  } finally {
    undo();
  }
  restoreMissing(b, node, picsOf(bands[0]!), k);
  b.save();
  b.scale(k, k);
  for (const u of unders) drawShot(b, node, u);
  b.restore();

  /**
   * Only `keep` drawn (with everything else hidden): the boxes holding parts show none of
   * their own paint (background, shadows, ::before/::after: drawn below). They stay visible
   * themselves: a hidden box's mask (soft edges, a cut-out's outline) isn't applied to what
   * it holds.
   */
  const drawOnly = async (keep: HTMLElement[], ratio = pr) => {
    const band = canvasOf(outW, outH);
    const a = band.getContext('2d')!;
    const kept = new Set(keep);
    undo = hideFor([
      ...effects,
      ...[...bands.flat(), ...allGroupStills].filter((e) => !kept.has(e)),
      ...topShots,
    ]);
    // A box with words of its own (not in a child) is hidden instead, its parts shown.
    const words = (e: HTMLElement) =>
      [...e.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim());
    const bare = [node, ...holders].filter((e) => !words(e));
    const shut = [node, ...holders].filter(words);
    const was = bare.map((e) => [e.style.background, e.style.boxShadow] as const);
    const vis = [...shut, ...keep].map((e) => e.style.visibility);
    bare.forEach((e) => {
      e.style.background = 'none';
      e.style.boxShadow = 'none';
      e.classList.add('rec-bare');
    });
    shut.forEach((e) => (e.style.visibility = 'hidden'));
    keep.forEach((e) => (e.style.visibility = 'visible'));
    try {
      const pic = await draw(ratio);
      a.drawImage(pic, 0, 0, outW, outH);
      freeCanvas(pic);
      restoreMissing(a, node, picsOf(keep), k);
    } finally {
      undo();
      bare.forEach((e, j) => {
        e.style.background = was[j]![0];
        e.style.boxShadow = was[j]![1];
        e.classList.remove('rec-bare');
      });
      [...shut, ...keep].forEach((e, j) => (e.style.visibility = vis[j]!));
    }
    return band;
  };

  /**
   * `keep` drawn; when the picture comes back empty although there is something to show
   * (a phone out of memory gives back a blank picture without a word), once more at half
   * the size — a softer band beats a missing one.
   */
  const kept = async (keep: HTMLElement[]) => {
    const band = await drawOnly(keep);
    if (!looksBlank(band) || !keep.some(shows)) return band;
    freeCanvas(band);
    return drawOnly(keep, pr / 2);
  };

  const over: (Piece | null)[] = [];
  for (let i = 1; i < bands.length; i++) {
    const last = i === bands.length - 1;
    // Only this band's parts (what the block paints itself was drawn below).
    const keep = bands[i]!.filter((e) => !topShots.some((x) => x === e));
    if (keep.length === 0 && !(last && topShots.length)) {
      over.push(null);
      continue;
    }
    const band = keep.length ? await kept(keep) : canvasOf(outW, outH);
    if (last) {
      const a = band.getContext('2d')!;
      a.save();
      a.scale(k, k);
      for (const t of topShots) drawShot(a, node, t);
      a.restore();
    }
    over.push(cropped(band));
  }

  // Each group's still parts, drawn unblended and whole (its own blend and opacity are
  // given to the group when it goes onto the frame).
  const groups: Group[] = [];
  for (const [gi, g] of groupEls.entries()) {
    const fx = effects.flatMap((e, i) => (g.contains(e) ? [i] : []));
    const first = effects[fx[0]!]!;
    const stills = groupStills[gi]!;
    const before = stills.filter(
      (e) => first.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING,
    );
    const after = stills.filter((e) => !before.includes(e));
    const css = getComputedStyle(g);
    const blend = css.mixBlendMode === 'plus-lighter' ? 'lighter' : css.mixBlendMode;
    // The group's own opacity and its holders' go to the whole group.
    let alpha = 1;
    for (let e: HTMLElement | null = g; e && e !== node; e = e.parentElement)
      alpha *= Number.parseFloat(getComputedStyle(e).opacity) || 1;
    const was = [g.style.mixBlendMode, g.style.opacity];
    g.style.mixBlendMode = 'normal';
    g.style.opacity = '1';
    try {
      groups.push({
        el: g,
        fx,
        under: before.length ? cropped(await kept(before)) : null,
        top: after.length ? cropped(await kept(after)) : null,
        blend: blend as GlobalCompositeOperation,
        alpha,
      });
    } finally {
      g.style.mixBlendMode = was[0]!;
      g.style.opacity = was[1]!;
    }
  }
  return { below, over, effects, groups };
}

/** One effect layer, ready to be drawn at any moment. */
interface Effect {
  el: HTMLElement;
  box: { x: number; y: number; w: number; h: number };
  blend: GlobalCompositeOperation;
  /** How see-through the layers holding it make it. */
  opacity: number;
  /** Its own opacity (a drawn copy carries it already; a live canvas doesn't). */
  ownOpacity: number;
  canvas: HTMLCanvasElement | null;
  anims: Animation[];
  /** The masks of the boxes it sits in (a cut-out's outline, letters, soft edges). */
  masks: Mask[];
  /** A layer's filters (blur, black and white…) at the recording's scale, or none. */
  filter: Filter | null;
}

/**
 * The filters of the adjusted layer an effect sits in (LayeredPoster `data-adjust`), for
 * the canvas the effect is drawn onto: blurs scaled to the recording's size.
 */
function filterOf(el: HTMLElement, node: HTMLElement, k: number): Filter | null {
  const box = el.parentElement?.closest<HTMLElement>('[data-adjust]');
  if (!box || !node.contains(box)) return null;
  const f = getComputedStyle(box).filter;
  if (!f || f === 'none') return null;
  return {
    css: f.replace(/blur\(([\d.]+)px\)/g, (_, px: string) => `blur(${Number(px) * k}px)`),
    grain: Number(box.dataset.grain) || 0,
    frost: Number(box.dataset.frost) || 0,
    vignette: Number(box.dataset.vignette) || 0,
  };
}

/**
 * Whether a box starts a group of its own on the page (a stacking context): a blend mode
 * inside such a group mixes only with what else is in it, never with the layers under it.
 */
function isolates(css: CSSStyleDeclaration): boolean {
  const none = (v: string | undefined) => !v || v === 'none' || v === 'auto' || v === 'normal';
  return (
    Number.parseFloat(css.opacity) < 1 ||
    !none(css.transform) ||
    !none(css.translate) ||
    !none(css.rotate) ||
    !none(css.scale) ||
    !none(css.filter) ||
    !none(css.maskImage) ||
    !none(css.getPropertyValue('-webkit-mask-image')) ||
    !none(css.clipPath) ||
    !none(css.mixBlendMode) ||
    css.isolation === 'isolate' ||
    /paint|strict|content/.test(css.contain) ||
    (css.position !== 'static' && !none(css.zIndex))
  );
}

/**
 * Whether a box's blend mode mixes with what is already on the frame when it is drawn. On
 * the page it mixes with what was painted before it inside its group (the nearest box
 * starting a group of its own): the poster's own box holds the layers under a text set to
 * multiply, so that blend reaches them; the letters' masked box holds nothing before an
 * effect drawn alone in it, so that blend mixes with nothing and the effect stays plain.
 */
function blendReaches(e: HTMLElement, stop: HTMLElement): boolean {
  let group: HTMLElement = stop;
  for (let p = e.parentElement; p && p !== stop; p = p.parentElement)
    if (isolates(getComputedStyle(p))) {
      group = p;
      break;
    }
  if (group === stop) return true;
  // Anything painted before it in its group (not a box it sits in).
  for (const x of group.querySelectorAll<HTMLElement>('*')) {
    if (x === e || x.contains(e)) continue;
    if (x.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) return true;
    break;
  }
  return false;
}

/**
 * How the layers holding an effect show it: their see-through-ness multiplied, and the blend
 * mode that really reaches the layers under it. A poster layer sets both on its own box
 * (LayeredPoster `look`, `Adjusted`), around the effect — read from the effect alone, a
 * half-transparent or blended layer was recorded at full strength over what is under it.
 * A blend inside a group of its own (the letters' masked box, a moved layer) mixes only with
 * that group's insides on the page: taken onto the whole frame, an effect in black letters
 * set to multiply came out solid black. Such a blend is left out (see blendReaches).
 * `node` is where the reading stops: the poster, or the blended group the effect is drawn into.
 */
function heldLook(el: HTMLElement, node: HTMLElement) {
  let alpha = 1;
  for (let e = el.parentElement; e && e !== node; e = e.parentElement) {
    const o = Number.parseFloat(getComputedStyle(e).opacity);
    if (Number.isFinite(o)) alpha *= o;
  }
  // The innermost blend whose way up to the poster crosses no group of its own.
  let blend: string | null = null;
  for (let e: HTMLElement | null = el; e && e !== node; e = e.parentElement) {
    const mode = getComputedStyle(e).mixBlendMode;
    if (!mode || mode === 'normal') continue;
    if (blendReaches(e, node)) {
      blend = mode;
      break;
    }
  }
  return { alpha, blend };
}

/** A layer's adjustments: the CSS filter, and its SVG part (grain, frost, vignette). */
interface Filter {
  css: string;
  grain: number;
  frost: number;
  vignette: number;
}

/**
 * Whether this browser's canvas really applies CSS colour filters: tested on a pixel, as a
 * canvas may take the setting and draw nothing different (iPhones' Safari long did).
 */
let filterWorks: boolean | null = null;
function canvasFilters() {
  if (filterWorks === null) {
    try {
      const c = canvasOf(2, 2).getContext('2d', { willReadFrequently: true })!;
      c.filter = 'grayscale(1)';
      c.fillStyle = '#ff0000';
      c.fillRect(0, 0, 2, 2);
      const [r, g] = c.getImageData(0, 0, 1, 1).data;
      filterWorks = Math.abs(r! - g!) < 40;
    } catch {
      filterWorks = false;
    }
  }
  return filterWorks;
}

/** The colour and blur part of a layer's CSS filter (no SVG links: a canvas that can't
 * follow one into the page drops the whole list, colours too). */
const cssPart = (css: string) => css.replace(/url\([^)]*\)/g, '').trim();

/** Fine noise the size of the frame, made once (the grain of adjusted layers). */
let grainPic: HTMLCanvasElement | null = null;
function grainOf(w: number, h: number) {
  if (grainPic && grainPic.width === w && grainPic.height === h) return grainPic;
  grainPic = canvasOf(w, h);
  const g = grainPic.getContext('2d')!;
  const img = g.createImageData(w, h);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // About as spread as the SVG fractal noise on the page (mostly mid-grey).
    const v = 92 + ((seed >> 8) % 72);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grainPic;
}

/**
 * A layer's adjustments drawn by our own code, for a canvas that can't take CSS filters:
 * blur (a smaller copy enlarged), the colour filters as one colour matrix, then grain,
 * frost and vignette over the layer's own pixels — as the SVG filter of `Adjusted` does.
 */
function filtered(src: HTMLCanvasElement, f: Filter): HTMLCanvasElement {
  const { width: w, height: h } = src;
  const out = canvasOf(w, h);
  const o = out.getContext('2d', { willReadFrequently: true })!;
  const css = cssPart(f.css);
  const byCanvas = canvasFilters();
  const blur = /blur\(([\d.]+)px\)/.exec(f.css);
  if (byCanvas) {
    // The canvas does the colours and blur itself; only the SVG part is ours below.
    o.filter = css || 'none';
    o.drawImage(src, 0, 0);
    o.filter = 'none';
  } else if (blur && Number(blur[1]) > 0.5) {
    // Two halvings per doubling of the radius, enlarged back smoothly.
    const s = Math.max(1, Number(blur[1]) / 1.5);
    const tw = Math.max(1, Math.round(w / s));
    const th = Math.max(1, Math.round(h / s));
    const tiny = canvasOf(tw, th);
    const t = tiny.getContext('2d')!;
    t.imageSmoothingQuality = 'high';
    t.drawImage(src, 0, 0, tw, th);
    o.imageSmoothingQuality = 'high';
    o.drawImage(tiny, 0, 0, w, h);
    freeCanvas(tiny);
  } else o.drawImage(src, 0, 0);
  // The colour filters, in their CSS order, folded into one matrix.
  let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let add = [0, 0, 0];
  const mul = (n: number[], a: number[] = [0, 0, 0]) => {
    const r: number[] = [];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        r.push(n[i * 3]! * m[j]! + n[i * 3 + 1]! * m[3 + j]! + n[i * 3 + 2]! * m[6 + j]!);
    add = [0, 1, 2].map(
      (i) => n[i * 3]! * add[0]! + n[i * 3 + 1]! * add[1]! + n[i * 3 + 2]! * add[2]! + a[i]!,
    );
    m = r;
  };
  let touched = false;
  for (const [, name, arg] of byCanvas ? [] : f.css.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
    const v = arg!.trim().endsWith('%') ? Number.parseFloat(arg!) / 100 : Number.parseFloat(arg!);
    if (!Number.isFinite(v)) continue;
    touched ||= name !== 'blur' && name !== 'url';
    if (name === 'brightness') mul([v, 0, 0, 0, v, 0, 0, 0, v]);
    else if (name === 'contrast')
      mul(
        [v, 0, 0, 0, v, 0, 0, 0, v],
        [0, 1, 2].map(() => 0.5 - 0.5 * v),
      );
    else if (name === 'saturate' || name === 'grayscale') {
      const s = name === 'saturate' ? v : 1 - Math.min(1, v);
      mul([
        0.213 + 0.787 * s,
        0.715 - 0.715 * s,
        0.072 - 0.072 * s,
        0.213 - 0.213 * s,
        0.715 + 0.285 * s,
        0.072 - 0.072 * s,
        0.213 - 0.213 * s,
        0.715 - 0.715 * s,
        0.072 + 0.928 * s,
      ]);
    } else if (name === 'sepia') {
      const a = 1 - Math.min(1, v);
      mul([
        0.393 + 0.607 * a,
        0.769 - 0.769 * a,
        0.189 - 0.189 * a,
        0.349 - 0.349 * a,
        0.686 + 0.314 * a,
        0.168 - 0.168 * a,
        0.272 - 0.272 * a,
        0.534 - 0.534 * a,
        0.131 + 0.869 * a,
      ]);
    } else if (name === 'hue-rotate') {
      const r = (v * Math.PI) / 180;
      const c = Math.cos(r);
      const n = Math.sin(r);
      mul([
        0.213 + c * 0.787 - n * 0.213,
        0.715 - c * 0.715 - n * 0.715,
        0.072 - c * 0.072 + n * 0.928,
        0.213 - c * 0.213 + n * 0.143,
        0.715 + c * 0.285 + n * 0.14,
        0.072 - c * 0.072 - n * 0.283,
        0.213 - c * 0.213 - n * 0.787,
        0.715 - c * 0.715 + n * 0.715,
        0.072 + c * 0.928 + n * 0.072,
      ]);
    }
  }
  // Frost: a little lighter and paler (as the CSS part of adjustFilter adds), then milk.
  if (touched) {
    const img = o.getImageData(0, 0, w, h);
    const d = img.data;
    const a0 = add[0]! * 255;
    const a1 = add[1]! * 255;
    const a2 = add[2]! * 255;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      d[i] = m[0]! * r + m[1]! * g + m[2]! * b + a0 * (d[i + 3]! / 255);
      d[i + 1] = m[3]! * r + m[4]! * g + m[5]! * b + a1 * (d[i + 3]! / 255);
      d[i + 2] = m[6]! * r + m[7]! * g + m[8]! * b + a2 * (d[i + 3]! / 255);
    }
    o.putImageData(img, 0, 0);
  }
  const grain = Math.min(1, f.grain + f.frost * 0.35);
  if (grain > 0 || f.frost > 0 || f.vignette > 0) {
    // Laid over the layer's pixels only: drawn on a copy, then cut to the layer's shape.
    const shape = canvasOf(w, h);
    shape.getContext('2d')!.drawImage(out, 0, 0);
    o.save();
    if (grain > 0) {
      o.globalCompositeOperation = 'overlay';
      o.globalAlpha = grain * 0.7;
      o.drawImage(grainOf(w, h), 0, 0);
    }
    if (f.frost > 0) {
      o.globalCompositeOperation = 'source-over';
      o.globalAlpha = f.frost * 0.22;
      o.fillStyle = '#ffffff';
      o.fillRect(0, 0, w, h);
    }
    if (f.vignette > 0) {
      o.globalCompositeOperation = 'source-over';
      o.globalAlpha = 1;
      // The SVG's gradient: centred, 72 % of the box each way (an oval on a long poster).
      o.translate(w / 2, h / 2);
      o.scale(w, h);
      const v = o.createRadialGradient(0, 0, 0, 0, 0, 0.72);
      v.addColorStop(0.45, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(0,0,0,${Math.min(1, f.vignette * 0.95)})`);
      o.fillStyle = v;
      o.fillRect(-0.5, -0.5, 1, 1);
      o.setTransform(1, 0, 0, 1, 0, 0);
    }
    o.globalCompositeOperation = 'destination-in';
    o.globalAlpha = 1;
    o.drawImage(shape, 0, 0);
    o.restore();
    freeCanvas(shape);
  }
  return out;
}

/** A box's CSS mask drawn once as a picture of the box, placed where the box is. */
interface Mask {
  box: { x: number; y: number; w: number; h: number };
  pic: HTMLCanvasElement;
}

/** The corner-clipping trick (`radial-gradient(white, black)`) hides nothing: skipped. */
const CLIP_TRICK =
  /^(-webkit-)?radial-gradient\((white|rgb\(255, 255, 255\)), (black|rgb\(0, 0, 0\))\)$/;

/**
 * Draws a box's mask as a white picture with the mask's see-through parts: a single
 * picture mask (a cut-out, a text's letters) is drawn stretched over the box as the poster
 * sets it; anything else (soft edges, circles) is drawn by the browser on a copy of the box.
 */
async function drawMask(el: HTMLElement, css: CSSStyleDeclaration, k: number) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const pic = canvasOf(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  if (el.dataset.edge) {
    drawEdge(
      pic,
      el.dataset.edge,
      Number(el.dataset.soft) || 0,
      (Number.parseFloat(css.borderTopLeftRadius) || 0) * k,
    );
    return pic;
  }
  const image = css.maskImage && css.maskImage !== 'none' ? css.maskImage : css.webkitMaskImage;
  const one = /^url\("?([^")]+)"?\)$/.exec(image.trim());
  if (one) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = one[1]!;
    await img.decode().catch(() => undefined);
    if (img.naturalWidth) {
      const c = pic.getContext('2d')!;
      // Spread by about half a pixel of the recording: enlarged, the mask's soft edge left the
      // layer's own colour (dark letters) showing as a thin outline the screen doesn't have.
      // All round (eight ways), about a pixel: it covers the picture's own soft edge under it,
      // which video compression turned into a dotted dark rim.
      const r = Math.max(1, k * 0.3);
      const d = r * 0.7071;
      for (const [dx, dy] of [
        [0, 0],
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
        [d, d],
        [-d, d],
        [d, -d],
        [-d, -d],
      ] as const)
        c.drawImage(img, dx, dy, pic.width, pic.height);
    }
    return pic;
  }
  const { toCanvas } = await import('html-to-image');
  const copy = document.createElement('div');
  const keep = [
    'maskImage',
    'maskSize',
    'maskRepeat',
    'maskPosition',
    'maskComposite',
    'webkitMaskImage',
    'webkitMaskSize',
    'webkitMaskRepeat',
    'webkitMaskPosition',
    'webkitMaskComposite',
    'borderRadius',
    'clipPath',
  ] as const;
  for (const p of keep) if (css[p]) copy.style[p] = css[p];
  Object.assign(copy.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${w}px`,
    height: `${h}px`,
    background: '#fff',
  });
  document.body.appendChild(copy);
  try {
    const drawn = await toCanvas(copy, { pixelRatio: k, skipFonts: true, width: w, height: h });
    pic.getContext('2d')!.drawImage(drawn, 0, 0, pic.width, pic.height);
    freeCanvas(drawn);
  } catch {
    // Not drawable here: the effect goes unmasked rather than missing.
    pic.getContext('2d')!.fillRect(0, 0, pic.width, pic.height);
  } finally {
    copy.remove();
  }
  return pic;
}

/**
 * A poster layer's outline (LayeredPoster `data-edge`): a circle or oval fading out from
 * `soft`, or a (rounded) rectangle whose sides fade over soft × half the box.
 */
function drawEdge(pic: HTMLCanvasElement, shape: string, soft: number, radius: number) {
  const ctx = pic.getContext('2d')!;
  const W = pic.width;
  const H = pic.height;
  if (shape === 'circle' || shape === 'oval') {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (shape === 'oval') ctx.scale(W / 2, H / 2);
    else ctx.scale(Math.min(W, H) / 2, Math.min(W, H) / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(Math.max(0, 0.99 - soft * 0.99), '#fff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    return;
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  if (shape === 'rounded' && radius > 0) ctx.roundRect(0, 0, W, H, radius);
  else ctx.rect(0, 0, W, H);
  ctx.fill();
  if (soft <= 0) return;
  const p = Math.min(0.5, soft * 0.5);
  ctx.globalCompositeOperation = 'destination-in';
  for (const [x1, y1] of [
    [W, 0],
    [0, H],
  ] as const) {
    const g = ctx.createLinearGradient(0, 0, x1, y1);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(p, '#fff');
    g.addColorStop(1 - p, '#fff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** The masks round an effect, from its own box out to the block's (each drawn once). */
async function masksOf(
  node: HTMLElement,
  el: HTMLElement,
  k: number,
  drawn: Map<HTMLElement, Mask>,
): Promise<Mask[]> {
  const out: Mask[] = [];
  for (let p = el.parentElement; p && p !== node; p = p.parentElement) {
    const css = getComputedStyle(p);
    // The second half of a soft edge: drawn whole with the first (drawEdge).
    if (p.dataset.edgePart !== undefined) continue;
    const image = css.maskImage && css.maskImage !== 'none' ? css.maskImage : css.webkitMaskImage;
    const clipped = css.clipPath && css.clipPath !== 'none';
    if ((!image || image === 'none' || CLIP_TRICK.test(image)) && !clipped) continue;
    let m = drawn.get(p);
    if (!m) {
      m = { box: boxIn(node, p), pic: await drawMask(p, css, k) };
      drawn.set(p, m);
    }
    out.push(m);
  }
  return out;
}

/**
 * Pictures inside the effect layers, made safe for the drawing library before recording:
 * - generated textures (smoke, frost, grain, static, grunge, crack…: SVG noise, also as the
 *   blob pictures lib/texture.ts makes of them) — it turns those black;
 * - the cover photo that some effects draw themselves (TV glitch, RGB split, duotone,
 *   tilt-shift, oil…) — iPhones leave a big photo out of its drawing, so those effects
 *   covered the real photo with grey.
 * Each becomes an ordinary picture embedded in the page: textures at their own size,
 * photos no bigger than they show in the recording. Returns how to put the originals back.
 */
async function preparePictures(roots: HTMLElement[], k: number): Promise<() => void> {
  const undo: (() => void)[] = [];
  const done = new Map<string, string>();
  const els = roots.flatMap((r) => [r, ...r.querySelectorAll<HTMLElement>('*')]);
  for (const el of els) {
    const css = getComputedStyle(el);
    if (!css.backgroundImage.includes('url(')) continue;
    let replaced = css.backgroundImage;
    // Computed values quote their links; an SVG itself holds brackets (url(#filter)).
    for (const m of css.backgroundImage.matchAll(/url\("([^"]+)"\)/g)) {
      const url = m[1]!;
      // Already an embedded bitmap: nothing to do.
      if (/^data:image\/(png|jpe?g|gif|webp)/i.test(url)) continue;
      const texture = url.startsWith('data:image/svg+xml') || url.startsWith('blob:');
      // A photo is drawn for this element's size at the recording's scale.
      const longest = Math.max(el.offsetWidth, el.offsetHeight) * k;
      const key = texture ? url : `${url}|${Math.round(longest)}`;
      let pic = done.get(key);
      if (!pic) {
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const w = img.naturalWidth || 300;
          const h = img.naturalHeight || 150;
          const scale = texture ? 1 : Math.min(1, Math.max(320, longest * 1.15) / Math.max(w, h));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(h * scale));
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          // Textures keep their see-through parts; photos go as a small JPEG.
          pic = texture ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
          freeCanvas(c);
          done.set(key, pic);
        } catch {
          continue;
        }
      }
      replaced = replaced.replace(m[0], `url("${pic}")`);
    }
    if (replaced === css.backgroundImage) continue;
    const before = el.style.backgroundImage;
    el.style.backgroundImage = replaced;
    undo.push(() => (el.style.backgroundImage = before));
  }
  return () => undo.forEach((u) => u());
}

/**
 * The block's own pictures (poster picture layers, cut-outs) and the masks made of them,
 * embedded as small copies before the still parts are drawn. iPhones leave big pictures
 * out of the drawing library's picture now and then: a cut-out logo with an effect inside
 * its letters came out as the effect alone, pale on white (the letters themselves were
 * missing under it). A copy is no bigger than it shows in the recording; a picture with
 * see-through parts stays a PNG, others become a JPEG. Returns how to put them back.
 */
async function prepareImages(node: HTMLElement, k: number): Promise<() => void> {
  const undo: (() => void)[] = [];
  const done = new Map<string, string | null>();
  const copyOf = async (url: string, longest: number) => {
    if (/^data:/i.test(url)) return null;
    const key = `${url}|${Math.round(longest)}`;
    if (done.has(key)) return done.get(key)!;
    let out: string | null;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await img.decode();
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      const scale = Math.min(1, Math.max(320, longest * 1.1) / Math.max(w, h));
      const c = canvasOf(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // See-through anywhere? (a sparse sample is enough to tell a cut-out from a photo)
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let clear = false;
      for (let i = 3; i < px.length && !clear; i += 4 * 97) clear = px[i]! < 250;
      out = clear ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
      freeCanvas(c);
    } catch {
      out = null;
    }
    done.set(key, out);
    return out;
  };
  for (const el of [node, ...node.querySelectorAll<HTMLElement>('*')]) {
    // Effects are handled on their own (preparePictures); their pictures stay as they are.
    if (el.closest('.living-clip')) continue;
    const longest = Math.max(el.offsetWidth, el.offsetHeight) * k;
    if (!longest) continue;
    if (el instanceof HTMLImageElement && el.currentSrc) {
      const pic = await copyOf(el.currentSrc, longest);
      if (pic) {
        const before = el.getAttribute('src');
        const set = el.getAttribute('srcset');
        el.removeAttribute('srcset');
        el.src = pic;
        undo.push(() => {
          if (set !== null) el.setAttribute('srcset', set);
          if (before !== null) el.setAttribute('src', before);
        });
      }
    }
    // A mask made of a picture (a cut-out's outline, letters): the same small copy.
    for (const prop of ['maskImage', 'webkitMaskImage'] as const) {
      const v = el.style[prop];
      const m = v && /url\("?([^")]+)"?\)/.exec(v);
      if (!m) continue;
      const pic = await copyOf(m[1]!, longest);
      if (!pic) continue;
      el.style[prop] = v.replace(m[0], `url("${pic}")`);
      undo.push(() => (el.style[prop] = v));
    }
  }
  // The new copies must be decoded before the drawing library reads the page.
  await picturesReady(node);
  return () => undo.reverse().forEach((u) => u());
}

async function prepareEffects(
  node: HTMLElement,
  effects: HTMLElement[],
  k: number,
  groups: Group[] = [],
): Promise<Effect[]> {
  const drawn = new Map<HTMLElement, Mask>();
  const masks = await Promise.all(effects.map((el) => masksOf(node, el, k, drawn)));
  return effects.map((el, i) => {
    const css = getComputedStyle(el);
    // How the layer mixes with what is under it (the same names, but one).
    // Inside a blended group: read up to the group (it gets its own blend and opacity).
    const held = heldLook(el, groups.find((g) => g.el.contains(el))?.el ?? node);
    const own = css.mixBlendMode && css.mixBlendMode !== 'normal' ? css.mixBlendMode : null;
    const raw = own ?? held.blend ?? 'normal';
    const mode = raw === 'plus-lighter' ? 'lighter' : raw;
    const anims = el.getAnimations({ subtree: true });
    anims.forEach((a) => a.pause());
    const canvas = el.querySelector('canvas');
    return {
      el,
      box: boxIn(node, el),
      blend: (mode === 'normal' ? 'source-over' : mode) as GlobalCompositeOperation,
      // A drawn copy of the layer carries its own opacity already; the canvas doesn't.
      opacity: held.alpha,
      ownOpacity: Number(css.opacity),
      // A particle layer is one canvas we draw ourselves (no CSS animations in it).
      canvas: canvas && anims.length === 0 ? canvas : null,
      anims,
      filter: filterOf(el, node, k),
      masks: masks[i]!,
    };
  });
}

/** Where masked effects are put together before going onto the frame. */
let maskScratch: HTMLCanvasElement | null = null;

/** Where blended groups are put together before going onto the frame. */
let groupScratch: HTMLCanvasElement | null = null;

/** One effect as it is `t` seconds in, onto `ctx` (the frame, or a group being put together). */
async function drawOne(ctx: CanvasRenderingContext2D, fx: Effect, t: number, k: number) {
  const { toCanvas } = await import('html-to-image');
  let pic: HTMLCanvasElement;
  if (fx.canvas) {
    seekParticles(fx.el, t);
    seekGpu(fx.el, t);
    seekShaders(fx.el, t);
    pic = fx.canvas;
  } else {
    for (const a of fx.anims) a.currentTime = t * 1000;
    if (fx.el.querySelector('canvas')) {
      seekParticles(fx.el, t);
      seekGpu(fx.el, t);
      seekShaders(fx.el, t);
    }
    pic = await toCanvas(fx.el, {
      pixelRatio: k,
      skipFonts: true,
      width: fx.el.offsetWidth,
      height: fx.el.offsetHeight,
    });
  }
  let src: CanvasImageSource = pic;
  let at = [fx.box.x * k, fx.box.y * k, fx.box.w * k, fx.box.h * k] as const;
  if (fx.masks.length > 0) {
    // Inside its masks only: drawn alone, cut to each mask, then put on the frame.
    const { width, height } = ctx.canvas;
    if (!maskScratch || maskScratch.width !== width || maskScratch.height !== height)
      maskScratch = canvasOf(width, height);
    const m = maskScratch.getContext('2d')!;
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, width, height);
    m.drawImage(pic, ...at);
    m.globalCompositeOperation = 'destination-in';
    for (const mask of fx.masks)
      m.drawImage(mask.pic, mask.box.x * k, mask.box.y * k, mask.box.w * k, mask.box.h * k);
    src = maskScratch;
    at = [0, 0, width, height];
  }
  // The layer's adjustments: colours and blur by the canvas where it really can, else by
  // our own code (iPhones); grain, frost and vignette always by ours (filtered).
  let own: HTMLCanvasElement | null = null;
  if (fx.filter) {
    if (src !== maskScratch) {
      // Drawn alone at its place on a frame-sized copy first, so grain and vignette sit
      // where the layer does.
      const { width, height } = ctx.canvas;
      const c = canvasOf(width, height);
      c.getContext('2d')!.drawImage(src, ...at);
      at = [0, 0, width, height];
      own = filtered(c, fx.filter);
      freeCanvas(c);
    } else own = filtered(maskScratch, fx.filter);
    src = own;
  }
  ctx.save();
  ctx.globalAlpha = fx.opacity * (fx.canvas ? fx.ownOpacity : 1);
  ctx.globalCompositeOperation = fx.blend;
  ctx.drawImage(src, ...at);
  ctx.restore();
  if (own) freeCanvas(own);
  // A drawn copy of the layer is used once; the particle canvas is the live one.
  if (!fx.canvas) freeCanvas(pic);
}

/**
 * Draws every effect as it is `t` seconds in, each followed by the still parts lying on
 * it (`over`, from stillParts). A blended group's effects are drawn into the group with
 * its still parts, and the group then blended onto the frame where its first effect is.
 */
async function drawEffects(
  ctx: CanvasRenderingContext2D,
  list: Effect[],
  t: number,
  k: number,
  over: (Piece | null)[] = [],
  groups: Group[] = [],
) {
  for (const [i, fx] of list.entries()) {
    const group = groups.find((g) => g.fx.includes(i));
    if (!group) await drawOne(ctx, fx, t, k);
    else if (group.fx[0] === i) {
      const { width, height } = ctx.canvas;
      if (!groupScratch || groupScratch.width !== width || groupScratch.height !== height)
        groupScratch = canvasOf(width, height);
      const g = groupScratch.getContext('2d')!;
      g.clearRect(0, 0, width, height);
      if (group.under) g.drawImage(group.under.pic, group.under.x, group.under.y);
      for (const j of group.fx) await drawOne(g, list[j]!, t, k);
      if (group.top) g.drawImage(group.top.pic, group.top.x, group.top.y);
      ctx.save();
      ctx.globalAlpha = group.alpha;
      ctx.globalCompositeOperation = group.blend;
      ctx.drawImage(groupScratch, 0, 0);
      ctx.restore();
    }
    const still = over[i];
    if (still) ctx.drawImage(still.pic, still.x, still.y);
  }
}

/** The colours of our video frames: BT.709, limited range (see toI420). */
const BT709: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
};

/**
 * RGBA pixels as I420 video (BT.709, limited range): full-size brightness, then colour at
 * half size each way. See-through pixels count as over black.
 */
function toI420(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array((w * h * 3) / 2);
  const uOff = w * h;
  const vOff = uOff + (w * h) / 4;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      let ur = 0;
      let ug = 0;
      let ub = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const p = (y + dy) * w + (x + dx);
          const a = rgba[p * 4 + 3]! / 255;
          const r = rgba[p * 4]! * a;
          const g = rgba[p * 4 + 1]! * a;
          const b = rgba[p * 4 + 2]! * a;
          out[p] = 16 + 0.1826 * r + 0.6142 * g + 0.062 * b;
          ur += r;
          ug += g;
          ub += b;
        }
      ur /= 4;
      ug /= 4;
      ub /= 4;
      const c = (y / 2) * (w / 2) + x / 2;
      out[uOff + c] = 128 - 0.1006 * ur - 0.3386 * ug + 0.4392 * ub;
      out[vOff + c] = 128 + 0.4392 * ur - 0.3989 * ug - 0.0403 * ub;
    }
  }
  return out;
}

/** The same as I420, with the two colour planes woven into one (U, V, U, V…). */
function toNV12(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const planar = toI420(rgba, w, h);
  const out = new Uint8Array(planar.length);
  const ySize = w * h;
  const q = ySize / 4;
  out.set(planar.subarray(0, ySize));
  for (let i = 0; i < q; i++) {
    out[ySize + i * 2] = planar[ySize + i]!;
    out[ySize + i * 2 + 1] = planar[ySize + q + i]!;
  }
  return out;
}

/** Ways of handing a frame to the video encoder (see pickFeed). */
type Feed = 'i420' | 'nv12' | 'rgba' | 'canvas';
const FEEDS: Feed[] = ['i420', 'nv12', 'rgba', 'canvas'];

/** One frame of `canvas` for the encoder, handed over the given way. */
function frameOf(
  feed: Feed,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timing: { timestamp: number; duration?: number },
): VideoFrame {
  if (feed === 'canvas') return new VideoFrame(canvas, timing);
  const { data } = ctx.getImageData(0, 0, w, h);
  const size = { codedWidth: w, codedHeight: h };
  if (feed === 'rgba')
    return new VideoFrame(data, {
      ...timing,
      ...size,
      format: 'RGBA',
      colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
    });
  return feed === 'nv12'
    ? new VideoFrame(toNV12(data, w, h), { ...timing, ...size, format: 'NV12', colorSpace: BT709 })
    : new VideoFrame(toI420(data, w, h), { ...timing, ...size, format: 'I420', colorSpace: BT709 });
}

/** The colours the file says it has: the encoder's own, unless it reports none or "rgb". */
function labelOf(meta: EncodedVideoChunkMetadata): VideoColorSpaceInit {
  const cs = meta.decoderConfig?.colorSpace;
  return cs?.matrix && cs.matrix !== 'rgb' && cs.primaries && cs.transfer ? cs : BT709;
}

/** The feed that came back right on this phone, per encoder setting (checked once). */
const feedFor = new Map<string, Feed | null>();

/**
 * Finds a way of handing frames to this phone's encoder that comes back with the right
 * colours: a test picture (red, green, blue, white) is encoded each way and decoded again
 * on the phone. iPhones turned a red cover blue in the video while the GIF of the same
 * frames was right. Null when no way works: then the recording makes a GIF instead.
 */
async function pickFeed(config: VideoEncoderConfig): Promise<Feed | null> {
  const key = `${config.codec}|${config.width}x${config.height}`;
  if (feedFor.has(key)) return feedFor.get(key)!;
  if (typeof VideoDecoder === 'undefined') return 'i420';
  const w = config.width;
  const h = config.height;
  const test = canvasOf(w, h);
  const tc = test.getContext('2d', { willReadFrequently: true })!;
  const colours: [number, number, number][] = [
    [224, 24, 24],
    [24, 192, 24],
    [24, 24, 224],
    [240, 240, 240],
  ];
  colours.forEach(([r, g, b], i) => {
    tc.fillStyle = `rgb(${r},${g},${b})`;
    tc.fillRect((i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), w / 2, h / 2);
  });
  const check = canvasOf(w, h);
  const cc = check.getContext('2d', { willReadFrequently: true })!;
  let found: Feed | null = null;
  for (const feed of FEEDS) {
    try {
      const chunks: EncodedVideoChunk[] = [];
      let decoderConfig: VideoDecoderConfig | undefined;
      const enc = new VideoEncoder({
        output: (chunk, meta) => {
          chunks.push(chunk);
          if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
        },
        error: () => undefined,
      });
      enc.configure(config);
      const vf = frameOf(feed, test, tc, w, h, { timestamp: 0 });
      enc.encode(vf, { keyFrame: true });
      vf.close();
      await enc.flush();
      enc.close();
      if (!decoderConfig || chunks.length === 0) continue;
      let back: VideoFrame | null = null;
      const dec = new VideoDecoder({
        output: (f) => {
          back?.close();
          back = f;
        },
        error: () => undefined,
      });
      dec.configure(decoderConfig);
      dec.decode(chunks[0]!);
      await dec.flush();
      dec.close();
      const decoded = back as VideoFrame | null;
      if (!decoded) continue;
      cc.clearRect(0, 0, w, h);
      cc.drawImage(decoded, 0, 0, w, h);
      decoded.close();
      const right = colours.every(([r, g, b], i) => {
        const x = Math.round((i % 2) * (w / 2) + w / 4);
        const y = Math.round(Math.floor(i / 2) * (h / 2) + h / 4);
        const [pr, pg, pb] = cc.getImageData(x, y, 1, 1).data;
        return Math.abs(pr! - r) < 60 && Math.abs(pg! - g) < 60 && Math.abs(pb! - b) < 60;
      });
      if (right) {
        found = feed;
        break;
      }
    } catch {
      // This way isn't supported here: the next one.
    }
  }
  freeCanvas(test);
  freeCanvas(check);
  feedFor.set(key, found);
  return found;
}

/** A 4×4 ordered (Bayer) pattern, -0.5…0.5. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16 - 0.5,
);

/**
 * Fine fixed noise before a GIF's colours are cut to 256: smooth gradients become an even
 * grain instead of visible stripes (GIFs can't hold more colours).
 */
function dither(data: Uint8ClampedArray, width: number) {
  const amount = 10;
  for (let i = 0; i < data.length; i += 4) {
    const p = i / 4;
    const d = BAYER[((p / width) & 3) * 4 + ((p % width) & 3)]! * amount;
    data[i] = data[i]! + d;
    data[i + 1] = data[i + 1]! + d;
    data[i + 2] = data[i + 2]! + d;
  }
}

/** The best H.264 setting this phone can encode at this size, or null. */
async function videoConfig(width: number, height: number, fps: number, bpp: number) {
  if (typeof VideoEncoder === 'undefined') return null;
  // Level 4.0 first (plays everywhere, up to Full HD); bigger own sizes need level 5.1.
  const codecs = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42e01f'];
  if (width * height > 1920 * 1088) codecs.unshift('avc1.640033', 'avc1.4d0033', 'avc1.42e033');
  for (const codec of codecs) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: Math.round(width * height * fps * bpp),
      framerate: fps,
      avc: { format: 'avc' },
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

/** A part of the block made ready to draw at any moment: its still bands and effects. */
interface Scene {
  below: HTMLCanvasElement;
  over: (Piece | null)[];
  groups: Group[];
  list: Effect[];
  canvases: HTMLCanvasElement[];
  restore: () => void;
}

/** Gets what is on the block now ready to record (see recordLoop for the steps). */
async function prepareScene(node: HTMLElement, k: number, outW: number, outH: number) {
  // Layers put on the block since the last scene (a slide's) are held for recording too.
  holdParticles(node, true, k);
  holdGpu(node, true);
  holdShaders(node, true, k);
  await picturesReady(node);
  await document.fonts?.ready;
  await nextFrame();
  const restoreImages = await prepareImages(node, k);
  const canvases: HTMLCanvasElement[] = [];
  try {
    const { below, over, effects, groups } = await stillParts(node, k, outW, outH);
    canvases.push(below, ...over.flatMap((c) => (c ? [c.pic] : [])));
    for (const g of groups) canvases.push(...[g.under, g.top].flatMap((c) => (c ? [c.pic] : [])));
    const list = await prepareEffects(node, effects, k, groups);
    for (const fx of list) canvases.push(...fx.masks.map((m) => m.pic));
    const restoreTextures = await preparePictures(effects, k);
    // iPhones may leave pictures out of the library's very first drawing of a layer.
    const scratch = canvasOf(outW, outH);
    await drawEffects(scratch.getContext('2d')!, list, 0, k);
    freeCanvas(scratch);
    const scene: Scene = {
      below,
      over,
      groups,
      list,
      canvases,
      restore: () => {
        restoreTextures();
        restoreImages();
      },
    };
    return scene;
  } catch (err) {
    canvases.forEach(freeCanvas);
    restoreImages();
    throw err;
  }
}

function freeScene(s: Scene) {
  s.canvases.forEach(freeCanvas);
  s.restore();
}

async function drawScene(ctx: CanvasRenderingContext2D, s: Scene, t: number, k: number) {
  ctx.drawImage(s.below, 0, 0);
  await drawEffects(ctx, s.list, t, k, s.over, s.groups);
}

/** The video encoder and the GIF, fed one finished frame at a time. */
async function makeOutput(
  outW: number,
  outH: number,
  fps: number,
  opts: RecordOptions,
  used: HTMLCanvasElement[],
) {
  const config =
    opts.video === false ? null : await videoConfig(outW, outH, fps, opts.quality ?? 0.12);
  // How frames go to the encoder here; none that comes back right = a GIF instead.
  const feed = config ? await pickFeed(config) : null;
  let encoder: VideoEncoder | null = null;
  let muxer: Muxer<ArrayBufferTarget> | null = null;
  if (config && feed) {
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: outW, height: outH, frameRate: fps },
      fastStart: 'in-memory',
    });
    const m = muxer;
    encoder = new VideoEncoder({
      output: (chunk, meta) =>
        m.addVideoChunk(
          chunk,
          meta?.decoderConfig
            ? { ...meta, decoderConfig: { ...meta.decoderConfig, colorSpace: labelOf(meta) } }
            : meta,
        ),
      error: () => undefined,
    });
    encoder.configure(config);
  }
  const wantGif = opts.gif || !encoder;
  const gifStep = Math.max(1, Math.round(fps / (opts.gifFps ?? 10)));
  const gifW = even(Math.min(outW, opts.gifWidth ?? 540));
  const gifH = even((outH * gifW) / outW);
  const gifCanvas = wantGif ? canvasOf(gifW, gifH) : null;
  if (gifCanvas) used.push(gifCanvas);
  const gifCtx = gifCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
  const gifenc = wantGif ? await import('gifenc') : null;
  const gif = gifenc?.GIFEncoder() ?? null;
  const out = canvasOf(outW, outH);
  const o = out.getContext('2d', { willReadFrequently: true })!;
  used.push(out);
  return {
    out,
    o,
    /** Frame j of the file is what `out` shows now. */
    async emit(j: number) {
      opts.onFrame?.(out, j);
      if (encoder) {
        const vf = frameOf(feed!, out, o, outW, outH, {
          timestamp: Math.round((j * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        encoder.encode(vf, { keyFrame: j % (fps * 2) === 0 });
        vf.close();
        while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      }
      if (gif && gifCtx && gifenc && j % gifStep === 0) {
        gifCtx.drawImage(out, 0, 0, gifW, gifH);
        const { data } = gifCtx.getImageData(0, 0, gifW, gifH);
        dither(data, gifW);
        const palette = gifenc.quantize(data, 256, { format: 'rgb565' });
        const index = gifenc.applyPalette(data, palette, 'rgb565');
        gif.writeFrame(index, gifW, gifH, {
          palette,
          delay: Math.round((1000 * gifStep) / fps),
          repeat: 0,
        });
      }
    },
    async finish(): Promise<Recording> {
      let mp4: Blob | null = null;
      if (encoder && muxer) {
        await encoder.flush();
        encoder.close();
        muxer.finalize();
        mp4 = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      }
      let gifBlob: Blob | null = null;
      if (gif) {
        gif.finish();
        gifBlob = new Blob([gif.bytes()], { type: 'image/gif' });
      }
      return { mp4, gif: gifBlob, feed: encoder ? feed : null };
    },
  };
}

/** A picture kept as a blob, back as a canvas (what drawLook draws from). */
async function canvasFromBlob(b: Blob, w: number, h: number) {
  const bmp = await createImageBitmap(b);
  const c = canvasOf(w, h);
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c;
}

/**
 * Records a slideshow. Each change between slides is drawn as the slideshow's transition
 * (lib/slideshow.ts, the very formula the screen uses) between the outgoing slide at its
 * last moment and the incoming one at its first, both drawn alone (as on the screen, where
 * a slide moving in a change is a box of its own), over the background still moving. Then
 * each slide runs as itself with the background. Only one slide's layers are prepared at a
 * time, so a long slideshow costs no more memory than one slide. Where the loop joins, the
 * background of the first change fades from the end's into the start's, so it doesn't jump.
 */
async function recordSlides(
  node: HTMLElement,
  opts: RecordOptions & { slides: NonNullable<RecordOptions['slides']> },
): Promise<Recording> {
  const { seconds: lens, kinds, show } = opts.slides;
  const fps = opts.fps ?? 20;
  const n = lens.length;
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const T = lens.reduce((a, b) => a + b, 0);
  const W = node.offsetWidth;
  const H = node.offsetHeight;
  const k = (opts.width ?? 720) / W;
  const outW = even(W * k);
  const outH = opts.height ? even(opts.height) : even(H * k);
  const html = document.documentElement;
  const motion = html.dataset.motion;
  if (motion === 'off') html.dataset.motion = 'lively';
  const used: HTMLCanvasElement[] = [];
  const totalFrames = Math.round(T * fps);
  let done = 0;
  const tick = () => opts.onProgress?.(Math.min(0.99, done / (totalFrames + 2 * n)));
  try {
    // 1. Each slide's own layers alone at its first and last moment (kept as PNG pictures,
    //    see Piece about memory). The block's own backdrop is see-through meanwhile.
    const firsts: Blob[] = [];
    const lasts: Blob[] = [];
    const back = node.style.background;
    node.style.background = 'transparent';
    const pic = canvasOf(outW, outH);
    const pc = pic.getContext('2d')!;
    try {
      for (let i = 0; i < n; i++) {
        await show(i, true);
        const scene = await prepareScene(node, k, outW, outH);
        try {
          for (const [list, t] of [
            [firsts, starts[i]!],
            [lasts, starts[i]! + lens[i]! - 1 / fps],
          ] as const) {
            pc.clearRect(0, 0, outW, outH);
            await drawScene(pc, scene, t, k);
            const b = await new Promise<Blob | null>((r) => pic.toBlob(r, 'image/png'));
            list.push(b ?? new Blob());
            done++;
            tick();
          }
        } finally {
          freeScene(scene);
        }
      }
    } finally {
      node.style.background = back;
      freeCanvas(pic);
    }
    // 2. The background alone, kept for every change.
    await show(null, false);
    const bg = await prepareScene(node, k, outW, outH);
    const output = await makeOutput(outW, outH, fps, opts, used);
    const { o } = output;
    const tmp = canvasOf(outW, outH);
    const tc = tmp.getContext('2d')!;
    used.push(tmp);
    let j = 0;
    try {
      for (let i = 0; i < n; i++) {
        const startF = Math.round(starts[i]! * fps);
        const endF = Math.round((starts[i]! + lens[i]!) * fps);
        const changeF = Math.min(endF - startF, Math.round(opts.slides.change * fps));
        // The change into slide i.
        const prev = (i - 1 + n) % n;
        const A = await canvasFromBlob(lasts[prev]!, outW, outH);
        const B = await canvasFromBlob(firsts[i]!, outW, outH);
        try {
          for (let c = 0; c < changeF; c++) {
            const t = (startF + c) / fps;
            const p = (c + 0.5) / changeF;
            o.clearRect(0, 0, outW, outH);
            await drawScene(o, bg, t, k);
            if (i === 0) {
              // Where the loop joins: the end's background fading into the start's.
              tc.clearRect(0, 0, outW, outH);
              await drawScene(tc, bg, t + T, k);
              o.globalAlpha = 1 - p;
              o.drawImage(tmp, 0, 0);
              o.globalAlpha = 1;
            }
            const look = transitionAt(kinds[i] ?? 'fade', p, i * 7 + 3);
            drawLook(o, A, look.out);
            drawLook(o, B, look.in);
            drawFlash(o, look.flash);
            await output.emit(j++);
            done++;
            tick();
            if (c % 4 === 0) await nextFrame();
          }
        } finally {
          freeCanvas(A);
          freeCanvas(B);
        }
        // Then the slide as itself, with the background.
        if (endF - startF > changeF) {
          await show(i, false);
          const scene = await prepareScene(node, k, outW, outH);
          try {
            for (let f = startF + changeF; f < endF; f++) {
              o.clearRect(0, 0, outW, outH);
              await drawScene(o, scene, f / fps, k);
              await output.emit(j++);
              done++;
              tick();
              if (f % 4 === 0) await nextFrame();
            }
          } finally {
            freeScene(scene);
          }
        }
      }
    } finally {
      freeScene(bg);
    }
    const rec = await output.finish();
    opts.onProgress?.(1);
    return rec;
  } finally {
    used.forEach(freeCanvas);
    freeCanvas(maskScratch);
    maskScratch = null;
    freeCanvas(groupScratch);
    groupScratch = null;
    holdParticles(node, false);
    holdGpu(node, false);
    holdShaders(node, false);
    for (const a of node.getAnimations({ subtree: true })) a.play();
    if (motion === 'off') html.dataset.motion = motion;
  }
}

/**
 * Records the block's loop. The block must be laid out (it may be off screen); its
 * animations are stopped while recording.
 */
export async function recordLoop(node: HTMLElement, opts: RecordOptions = {}): Promise<Recording> {
  if (opts.slides && opts.slides.seconds.length > 0 && opts.still === undefined)
    return recordSlides(node, { ...opts, slides: opts.slides });
  const seconds = opts.seconds ?? 6;
  const fps = opts.fps ?? 20;
  const W = node.offsetWidth;
  const H = node.offsetHeight;
  const k = (opts.width ?? 720) / W;
  const outW = even(W * k);
  // An own size is kept to the pixel: the laid-out block is a pixel or so off its shape.
  const outH = opts.height ? even(opts.height) : even(H * k);
  const html = document.documentElement;
  // Animations switched off on this phone are switched on for the recording.
  const motion = html.dataset.motion;
  if (motion === 'off') html.dataset.motion = 'lively';
  holdParticles(node, true, k);
  holdGpu(node, true);
  holdShaders(node, true, k);
  await picturesReady(node);
  await document.fonts?.ready;
  await nextFrame();
  let restoreTextures: (() => void) | undefined;
  let restoreImages: (() => void) | undefined;
  // Every canvas of this recording, freed at the end (see freeCanvas).
  const used: HTMLCanvasElement[] = [];
  try {
    restoreImages = await prepareImages(node, k);
    const { below, over, effects, groups } = await stillParts(node, k, outW, outH);
    used.push(below, ...over.flatMap((c) => (c ? [c.pic] : [])));
    for (const g of groups) used.push(...[g.under, g.top].flatMap((c) => (c ? [c.pic] : [])));
    const list = await prepareEffects(node, effects, k, groups);
    for (const fx of list) used.push(...fx.masks.map((m) => m.pic));
    const scratch = canvasOf(outW, outH);
    used.push(scratch);
    restoreTextures = await preparePictures(effects, k);
    // iPhones may leave pictures out of the library's very first drawing of a layer: one
    // drawing of each, thrown away, before the frames that count.
    await drawEffects(scratch.getContext('2d')!, list, 0, k);
    if (opts.still !== undefined) {
      const pic = canvasOf(outW, outH);
      used.push(pic);
      const p = pic.getContext('2d')!;
      p.drawImage(below, 0, 0);
      await drawEffects(p, list, opts.still, k, over, groups);
      const png = await new Promise<Blob | null>((r) => pic.toBlob(r, 'image/png'));
      opts.onProgress?.(1);
      return { mp4: null, gif: null, feed: null, png };
    }
    const total = Math.round(seconds * fps);
    const fade = Math.round(fps * 0.75);

    const config =
      opts.video === false ? null : await videoConfig(outW, outH, fps, opts.quality ?? 0.12);
    // How frames go to the encoder here; none that comes back right = a GIF instead.
    const feed = config ? await pickFeed(config) : null;
    let encoder: VideoEncoder | null = null;
    let muxer: Muxer<ArrayBufferTarget> | null = null;
    if (config && feed) {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: outW, height: outH, frameRate: fps },
        fastStart: 'in-memory',
      });
      const m = muxer;
      encoder = new VideoEncoder({
        // The file says how to read its colours. An encoder fed screen pixels may report
        // "rgb", which the muxer writes as "identity" (players would read the colour
        // planes as red/green/blue): the file always says BT.709, the video standard.
        output: (chunk, meta) =>
          m.addVideoChunk(
            chunk,
            meta?.decoderConfig
              ? { ...meta, decoderConfig: { ...meta.decoderConfig, colorSpace: labelOf(meta) } }
              : meta,
          ),
        error: () => undefined,
      });
      encoder.configure(config);
    }

    // The GIF: half the frames, 540 px wide. A phone that can't make videos gets one too.
    const wantGif = opts.gif || !encoder;
    const gifStep = Math.max(1, Math.round(fps / (opts.gifFps ?? 10)));
    const gifW = even(Math.min(outW, opts.gifWidth ?? 540));
    const gifH = even((outH * gifW) / outW);
    const gifCanvas = wantGif ? canvasOf(gifW, gifH) : null;
    if (gifCanvas) used.push(gifCanvas);
    const gifCtx = gifCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    const gifenc = wantGif ? await import('gifenc') : null;
    const gif = gifenc?.GIFEncoder() ?? null;

    const frame = canvasOf(outW, outH);
    const f = frame.getContext('2d')!;
    const out = canvasOf(outW, outH);
    const o = out.getContext('2d', { willReadFrequently: true })!;
    used.push(frame, out);
    // The first moments, kept to fade the loop's end into.
    // Kept as JPEG pictures (a fifth of a megabyte each, not five): full-size canvases
    // here took most of the memory iPhones allow all canvases together (see Piece).
    const start: Blob[] = [];

    for (let i = 0; i < total + fade; i++) {
      const t = i / fps;
      f.clearRect(0, 0, outW, outH);
      f.drawImage(below, 0, 0);
      await drawEffects(f, list, t, k, over, groups);
      if (i < fade) {
        const kept = await new Promise<Blob | null>((r) => frame.toBlob(r, 'image/jpeg', 0.95));
        if (kept) start.push(kept);
        opts.onProgress?.(i / (total + fade));
        continue;
      }
      // Output frame j shows moment i; near the end it fades into the kept start.
      const j = i - fade;
      o.globalAlpha = 1;
      o.drawImage(frame, 0, 0);
      const kept = i >= total ? start[i - total] : undefined;
      if (kept) {
        const bmp = await createImageBitmap(kept);
        o.globalAlpha = (i - total + 1) / (fade + 1);
        o.drawImage(bmp, 0, 0, outW, outH);
        o.globalAlpha = 1;
        bmp.close();
      }
      if (encoder) {
        // Handed over the way that came back right on this phone (pickFeed).
        const vf = frameOf(feed!, out, o, outW, outH, {
          timestamp: Math.round((j * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        encoder.encode(vf, { keyFrame: j % (fps * 2) === 0 });
        vf.close();
        while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      }
      if (gif && gifCtx && gifenc && j % gifStep === 0) {
        gifCtx.drawImage(out, 0, 0, gifW, gifH);
        const { data } = gifCtx.getImageData(0, 0, gifW, gifH);
        dither(data, gifW);
        const palette = gifenc.quantize(data, 256, { format: 'rgb565' });
        const index = gifenc.applyPalette(data, palette, 'rgb565');
        gif.writeFrame(index, gifW, gifH, {
          palette,
          delay: Math.round((1000 * gifStep) / fps),
          repeat: 0,
        });
      }
      opts.onProgress?.(i / (total + fade));
      // Let the screen breathe (the progress bar moves, the phone doesn't freeze).
      if (i % 4 === 0) await nextFrame();
    }

    let mp4: Blob | null = null;
    if (encoder && muxer) {
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      mp4 = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    }
    let gifBlob: Blob | null = null;
    if (gif) {
      gif.finish();
      gifBlob = new Blob([gif.bytes()], { type: 'image/gif' });
    }
    opts.onProgress?.(1);
    return { mp4, gif: gifBlob, feed: encoder ? feed : null };
  } finally {
    used.forEach(freeCanvas);
    freeCanvas(maskScratch);
    maskScratch = null;
    freeCanvas(groupScratch);
    groupScratch = null;
    restoreTextures?.();
    restoreImages?.();
    holdParticles(node, false);
    holdGpu(node, false);
    holdShaders(node, false);
    for (const a of node.getAnimations({ subtree: true })) a.play();
    if (motion === 'off') html.dataset.motion = motion;
  }
}
