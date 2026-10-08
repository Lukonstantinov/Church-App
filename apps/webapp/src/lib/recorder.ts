import type { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { holdParticles, seekParticles } from '../components/ParticleCanvas';
import { boxIn, drawShot, picturesReady } from './poster';

/**
 * Records a poster (or any block) with its moving effects as a short seamless loop: an MP4
 * (plays like a GIF in Telegram and WhatsApp) and, when asked, a real GIF file.
 *
 * It works in layers, so only what moves is drawn again for every frame:
 * - below the effects (background, photos) and above them (texts, speaker photos, logo)
 *   are drawn once — photos by our own code, as iPhones leave big photos out of the
 *   drawing library's pictures (lib/poster.ts);
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
  /** Also make a GIF (smaller, fewer frames and colours). */
  gif?: boolean;
  onProgress?: (done: number) => void;
}

export interface Recording {
  /** Null when this phone can't make videos (then only the GIF). */
  mp4: Blob | null;
  gif: Blob | null;
}

/** Whether the block has anything moving to record. */
export const hasEffects = (node: HTMLElement) => node.querySelector('.living-clip') !== null;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** Elements to keep visible in one pass (the rest hidden); returns how to undo it. */
function onlyShow(node: HTMLElement, hidden: HTMLElement[]): () => void {
  const before = hidden.map((e) => e.style.visibility);
  hidden.forEach((e) => (e.style.visibility = 'hidden'));
  return () => hidden.forEach((e, i) => (e.style.visibility = before[i]!));
}

/** The topmost elements of a set (their insides go with them). */
const tops = (els: HTMLElement[]) => els.filter((e) => !els.some((o) => o !== e && o.contains(e)));

/**
 * Splits the block around its effects: what is painted before the first effect (below
 * it), the effects, and what comes after (above). Elements holding an effect are neither.
 */
function layers(node: HTMLElement) {
  const effects = tops([...node.querySelectorAll<HTMLElement>('.living-clip')]);
  const first = effects[0];
  const all = [...node.querySelectorAll<HTMLElement>('*')];
  const holds = (e: HTMLElement) => effects.some((x) => e.contains(x));
  const inEffect = (e: HTMLElement) => effects.some((x) => x.contains(e));
  const after: HTMLElement[] = [];
  const before: HTMLElement[] = [];
  for (const e of all) {
    if (inEffect(e) || holds(e)) continue;
    if (first && first.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) after.push(e);
    else before.push(e);
  }
  return { effects, before: tops(before), after: tops(after) };
}

/** A canvas of the block's size at the output scale. */
function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Draws the block's still parts once: `below` (background and photos) and `above` (texts,
 * speaker photos, logo) on see-through canvases at the output size.
 */
async function stillParts(node: HTMLElement, k: number, outW: number, outH: number) {
  const { toCanvas } = await import('html-to-image');
  const { effects, before, after } = layers(node);
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
  let undo = onlyShow(node, [...effects, ...after, ...unders]);
  try {
    b.drawImage(await draw(), 0, 0, outW, outH);
  } finally {
    undo();
  }
  b.save();
  b.scale(k, k);
  for (const u of unders) drawShot(b, node, u);
  b.restore();

  const above = canvasOf(outW, outH);
  const a = above.getContext('2d')!;
  // Only what comes after the effects; the block's own background was drawn below.
  const bg = node.style.background;
  node.style.background = 'none';
  undo = onlyShow(node, [...before, ...effects, ...topShots]);
  try {
    a.drawImage(await draw(), 0, 0, outW, outH);
  } finally {
    undo();
    node.style.background = bg;
  }
  a.save();
  a.scale(k, k);
  for (const t of topShots) drawShot(a, node, t);
  a.restore();
  return { below, above, effects };
}

/** One effect layer, ready to be drawn at any moment. */
interface Effect {
  el: HTMLElement;
  box: { x: number; y: number; w: number; h: number };
  blend: GlobalCompositeOperation;
  opacity: number;
  canvas: HTMLCanvasElement | null;
  anims: Animation[];
}

function prepareEffects(node: HTMLElement, effects: HTMLElement[]): Effect[] {
  return effects.map((el) => {
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
    };
  });
}

/** Draws every effect as it is `t` seconds in. */
async function drawEffects(
  ctx: CanvasRenderingContext2D,
  node: HTMLElement,
  list: Effect[],
  t: number,
  k: number,
) {
  const { toCanvas } = await import('html-to-image');
  for (const fx of list) {
    let pic: CanvasImageSource;
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
    ctx.save();
    ctx.globalAlpha = fx.canvas ? fx.opacity : 1;
    ctx.globalCompositeOperation = fx.blend;
    ctx.drawImage(pic, fx.box.x * k, fx.box.y * k, fx.box.w * k, fx.box.h * k);
    ctx.restore();
  }
}

/** The best H.264 setting this phone can encode at this size, or null. */
async function videoConfig(width: number, height: number, fps: number) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42e01f']) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: Math.round(width * height * fps * 0.12),
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
  try {
    const { below, above, effects } = await stillParts(node, k, outW, outH);
    const list = prepareEffects(node, effects);
    const total = Math.round(seconds * fps);
    const fade = Math.round(fps * 0.75);

    const config = await videoConfig(outW, outH, fps);
    let encoder: VideoEncoder | null = null;
    let muxer: Muxer<ArrayBufferTarget> | null = null;
    if (config) {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: outW, height: outH, frameRate: fps },
        fastStart: 'in-memory',
      });
      const m = muxer;
      encoder = new VideoEncoder({
        output: (chunk, meta) => m.addVideoChunk(chunk, meta),
        error: () => undefined,
      });
      encoder.configure(config);
    }

    // The GIF: half the frames, half the size. A phone that can't make videos gets one too.
    const wantGif = opts.gif || !encoder;
    const gifStep = Math.max(1, Math.round(fps / 10));
    const gifW = even(Math.min(outW, 400));
    const gifH = even((outH * gifW) / outW);
    const gifCanvas = wantGif ? canvasOf(gifW, gifH) : null;
    const gifCtx = gifCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    const gifenc = wantGif ? await import('gifenc') : null;
    const gif = gifenc?.GIFEncoder() ?? null;

    const frame = canvasOf(outW, outH);
    const f = frame.getContext('2d')!;
    const out = canvasOf(outW, outH);
    const o = out.getContext('2d')!;
    // The first moments, kept to fade the loop's end into.
    const start: HTMLCanvasElement[] = [];

    for (let i = 0; i < total + fade; i++) {
      const t = i / fps;
      f.clearRect(0, 0, outW, outH);
      f.drawImage(below, 0, 0);
      await drawEffects(f, node, list, t, k);
      f.drawImage(above, 0, 0);
      if (i < fade) {
        const keep = canvasOf(outW, outH);
        keep.getContext('2d')!.drawImage(frame, 0, 0);
        start.push(keep);
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
        const vf = new VideoFrame(out, {
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
    return { mp4, gif: gifBlob };
  } finally {
    holdParticles(node, false);
    for (const a of node.getAnimations({ subtree: true })) a.play();
    if (motion === 'off') html.dataset.motion = motion;
  }
}
