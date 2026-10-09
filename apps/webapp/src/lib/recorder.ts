import type { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { holdParticles, seekParticles } from '../components/ParticleCanvas';
import { boxIn, drawShot, freeCanvas, picturesReady } from './poster';

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
  /** Also make a GIF (fewer frames and colours). */
  gif?: boolean;
  /** Make the video too (default); off when only the GIF is wanted, which is quicker. */
  video?: boolean;
  /** Width of the GIF in pixels (default 540). */
  gifWidth?: number;
  /** Video quality: bits per pixel per frame (0.12 for posters; less for backgrounds). */
  quality?: number;
  onProgress?: (done: number) => void;
}

export interface Recording {
  /** Null when this phone can't make videos (then only the GIF). */
  mp4: Blob | null;
  gif: Blob | null;
  /** How frames went to the video encoder here (pickFeed); null = no video. */
  feed: string | null;
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

/** A canvas of the block's size at the output scale. */
function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Draws the block's still parts once, on see-through canvases at the output size: `below`
 * (background and photos), then for each effect what lies on it until the next effect
 * (null when nothing does) — the last one with the texts, speaker photos and logo.
 */
async function stillParts(node: HTMLElement, k: number, outW: number, outH: number) {
  const { toCanvas } = await import('html-to-image');
  const { effects, bands, holders } = layers(node);
  const unders = [...node.querySelectorAll<HTMLElement>('[data-shot="under"]')];
  const topShots = [...node.querySelectorAll<HTMLElement>('[data-shot="top"]')];
  const W = node.offsetWidth;
  const H = node.offsetHeight;
  const opts = { pixelRatio: k, skipFonts: false, width: W, height: H } as const;
  const draw = async () => {
    try {
      return await toCanvas(node, opts);
    } catch {
      // Embedding the fonts failed: without them.
      return toCanvas(node, { ...opts, skipFonts: true });
    }
  };

  const below = canvasOf(outW, outH);
  const b = below.getContext('2d')!;
  let undo = hideFor([...effects, ...bands.slice(1).flat(), ...unders]);
  try {
    const pic = await draw();
    b.drawImage(pic, 0, 0, outW, outH);
    freeCanvas(pic);
  } finally {
    undo();
  }
  b.save();
  b.scale(k, k);
  for (const u of unders) drawShot(b, node, u);
  b.restore();

  const over: (HTMLCanvasElement | null)[] = [];
  for (let i = 1; i < bands.length; i++) {
    const last = i === bands.length - 1;
    // Only this band's parts (what the block paints itself was drawn below).
    const keep = bands[i]!.filter((e) => !topShots.some((x) => x === e));
    if (keep.length === 0 && !(last && topShots.length)) {
      over.push(null);
      continue;
    }
    const band = canvasOf(outW, outH);
    const a = band.getContext('2d')!;
    // Everything else is hidden, and the boxes holding parts show none of their own paint
    // (background, shadows, ::before/::after: drawn below). They stay visible themselves:
    // a hidden box's mask (soft edges, a cut-out's outline) isn't applied to what it holds.
    undo = hideFor([...effects, ...bands.flatMap((b, j) => (j === i ? [] : b)), ...topShots]);
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
      if (keep.length) {
        const pic = await draw();
        a.drawImage(pic, 0, 0, outW, outH);
        freeCanvas(pic);
      }
    } finally {
      undo();
      bare.forEach((e, j) => {
        e.style.background = was[j]![0];
        e.style.boxShadow = was[j]![1];
        e.classList.remove('rec-bare');
      });
      [...shut, ...keep].forEach((e, j) => (e.style.visibility = vis[j]!));
    }
    if (last) {
      a.save();
      a.scale(k, k);
      for (const t of topShots) drawShot(a, node, t);
      a.restore();
    }
    over.push(band);
  }
  return { below, over, effects };
}

/** One effect layer, ready to be drawn at any moment. */
interface Effect {
  el: HTMLElement;
  box: { x: number; y: number; w: number; h: number };
  blend: GlobalCompositeOperation;
  opacity: number;
  canvas: HTMLCanvasElement | null;
  anims: Animation[];
  /** The masks of the boxes it sits in (a cut-out's outline, letters, soft edges). */
  masks: Mask[];
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
    if (img.naturalWidth) pic.getContext('2d')!.drawImage(img, 0, 0, pic.width, pic.height);
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

async function prepareEffects(
  node: HTMLElement,
  effects: HTMLElement[],
  k: number,
): Promise<Effect[]> {
  const drawn = new Map<HTMLElement, Mask>();
  const masks = await Promise.all(effects.map((el) => masksOf(node, el, k, drawn)));
  return effects.map((el, i) => {
    const css = getComputedStyle(el);
    // How the layer mixes with what is under it (the same names, but one).
    const mode = css.mixBlendMode === 'plus-lighter' ? 'lighter' : css.mixBlendMode;
    const anims = el.getAnimations({ subtree: true });
    anims.forEach((a) => a.pause());
    const canvas = el.querySelector('canvas');
    return {
      el,
      box: boxIn(node, el),
      blend: (mode === 'normal' ? 'source-over' : mode) as GlobalCompositeOperation,
      opacity: Number(css.opacity),
      // A particle layer is one canvas we draw ourselves (no CSS animations in it).
      canvas: canvas && anims.length === 0 ? canvas : null,
      anims,
      masks: masks[i]!,
    };
  });
}

/** Where masked effects are put together before going onto the frame. */
let maskScratch: HTMLCanvasElement | null = null;

/**
 * Draws every effect as it is `t` seconds in, each followed by the still parts lying on
 * it (`over`, from stillParts).
 */
async function drawEffects(
  ctx: CanvasRenderingContext2D,
  node: HTMLElement,
  list: Effect[],
  t: number,
  k: number,
  over: (HTMLCanvasElement | null)[] = [],
) {
  const { toCanvas } = await import('html-to-image');
  for (const [i, fx] of list.entries()) {
    let pic: HTMLCanvasElement;
    if (fx.canvas) {
      seekParticles(fx.el, t);
      pic = fx.canvas;
    } else {
      for (const a of fx.anims) a.currentTime = t * 1000;
      if (fx.el.querySelector('canvas')) seekParticles(fx.el, t);
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
    ctx.save();
    ctx.globalAlpha = fx.canvas ? fx.opacity : 1;
    ctx.globalCompositeOperation = fx.blend;
    ctx.drawImage(src, ...at);
    ctx.restore();
    // A drawn copy of the layer is used once; the particle canvas is the live one.
    if (!fx.canvas) freeCanvas(pic);
    const still = over[i];
    if (still) ctx.drawImage(still, 0, 0);
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
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42e01f']) {
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

/**
 * Records the block's loop. The block must be laid out (it may be off screen); its
 * animations are stopped while recording.
 */
export async function recordLoop(node: HTMLElement, opts: RecordOptions = {}): Promise<Recording> {
  const seconds = opts.seconds ?? 6;
  const fps = opts.fps ?? 20;
  const W = node.offsetWidth;
  const H = node.offsetHeight;
  const k = (opts.width ?? 720) / W;
  const outW = even(W * k);
  const outH = even(H * k);
  const html = document.documentElement;
  // Animations switched off on this phone are switched on for the recording.
  const motion = html.dataset.motion;
  if (motion === 'off') html.dataset.motion = 'lively';
  holdParticles(node, true);
  await picturesReady(node);
  await document.fonts?.ready;
  await nextFrame();
  let restoreTextures: (() => void) | undefined;
  // Every canvas of this recording, freed at the end (see freeCanvas).
  const used: HTMLCanvasElement[] = [];
  try {
    const { below, over, effects } = await stillParts(node, k, outW, outH);
    used.push(below, ...over.filter((c): c is HTMLCanvasElement => !!c));
    const list = await prepareEffects(node, effects, k);
    for (const fx of list) used.push(...fx.masks.map((m) => m.pic));
    const scratch = canvasOf(outW, outH);
    used.push(scratch);
    restoreTextures = await preparePictures(effects, k);
    // iPhones may leave pictures out of the library's very first drawing of a layer: one
    // drawing of each, thrown away, before the frames that count.
    await drawEffects(scratch.getContext('2d')!, node, list, 0, k);
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
    const gifStep = Math.max(1, Math.round(fps / 10));
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
    const start: HTMLCanvasElement[] = [];

    for (let i = 0; i < total + fade; i++) {
      const t = i / fps;
      f.clearRect(0, 0, outW, outH);
      f.drawImage(below, 0, 0);
      await drawEffects(f, node, list, t, k, over);
      if (i < fade) {
        const keep = canvasOf(outW, outH);
        keep.getContext('2d')!.drawImage(frame, 0, 0);
        start.push(keep);
        used.push(keep);
        opts.onProgress?.(i / (total + fade));
        continue;
      }
      // Output frame j shows moment i; near the end it fades into the kept start.
      const j = i - fade;
      o.globalAlpha = 1;
      o.drawImage(frame, 0, 0);
      if (i >= total) {
        o.globalAlpha = (i - total + 1) / (fade + 1);
        o.drawImage(start[i - total]!, 0, 0);
        o.globalAlpha = 1;
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
    restoreTextures?.();
    holdParticles(node, false);
    for (const a of node.getAnimations({ subtree: true })) a.play();
    if (motion === 'off') html.dataset.motion = motion;
  }
}
