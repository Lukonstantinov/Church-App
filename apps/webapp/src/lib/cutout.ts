import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { MEDIA_MAX_BYTES } from '@church/shared';
import { canvasToBlob } from './image';
import { freeCanvas } from './poster';

/**
 * Background removal on the phone: Google's MediaPipe "selfie multiclass" model (free,
 * Apache 2.0) finds the people in a photo. The photo never leaves the phone for this; the
 * engine (WebAssembly, copied into the app at build) and the model (16 MB, relayed by our
 * server: /media/model/…) are downloaded once and then come from the phone's cache.
 *
 * The model sees a photo at 256 × 256, so on its own its edges are rough. Here:
 * 1. a first look at the whole photo finds where the people are;
 * 2. a second look at just that part, closer up, gives a sharper outline (people small
 *    in the photo — a singer on a stage — gain the most);
 * 3. stray specks away from the people are dropped (bits of the stage, a lamp);
 * 4. the outline is fitted to the photo's own edges (a guided filter: the edge follows
 *    where the colours really change — hair, shoulders, fingers);
 * 5. the background is made without the people: the hole they leave is filled from the
 *    colours around it (blurred like a shallow-focus photo), for its own layer.
 * Made for people — objects without people in front aren't found.
 */

let loading: Promise<ImageSegmenter> | null = null;

/** The model, loaded on first use (kept for the next photo). */
function segmenter(): Promise<ImageSegmenter> {
  loading ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/mediapipe');
    return ImageSegmenter.createFromOptions(files, {
      // The phone's processor: slower than its graphics chip but works on every phone.
      baseOptions: { modelAssetPath: '/media/model/selfie-multiclass', delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  })();
  // A failed download is tried again next time.
  loading.catch(() => (loading = null));
  return loading;
}

/** Whether the model is already in this phone's memory (no download wait). */
export const cutoutReady = () => loading !== null;

export async function imageOf(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

/** How sure the model is that each pixel of `canvas` is a person (0…1), at w × h. */
function personMask(model: ImageSegmenter, canvas: HTMLCanvasElement, w: number, h: number) {
  const result = model.segment(canvas);
  const back = result.confidenceMasks?.[0];
  if (!back) {
    result.close();
    throw new Error('no mask');
  }
  const raw = back.getAsFloat32Array();
  const mw = back.width;
  const mh = back.height;
  const out = new Float32Array(w * h);
  // Category 0 is the background; read with smooth (bilinear) upscaling.
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, ((y + 0.5) * mh) / h - 0.5);
    const y0 = Math.min(mh - 1, Math.floor(fy));
    const y1 = Math.min(mh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, ((x + 0.5) * mw) / w - 0.5);
      const x0 = Math.min(mw - 1, Math.floor(fx));
      const x1 = Math.min(mw - 1, x0 + 1);
      const tx = fx - x0;
      const b =
        (raw[y0 * mw + x0]! * (1 - tx) + raw[y0 * mw + x1]! * tx) * (1 - ty) +
        (raw[y1 * mw + x0]! * (1 - tx) + raw[y1 * mw + x1]! * tx) * ty;
      out[y * w + x] = 1 - b;
    }
  }
  result.close();
  return out;
}

/** The box round the people (where the mask is over ½), or null when there are none. */
function bounds(mask: Float32Array, w: number, h: number) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]! > 0.5) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Drops the bits of the mask not joined to the people: parts smaller than a tenth of the
 * biggest one (worked out on a small copy, 4-connected).
 */
function dropSpecks(mask: Float32Array, w: number, h: number) {
  const k = Math.min(1, 200 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * k));
  const sh = Math.max(1, Math.round(h * k));
  const small = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const v = mask[Math.min(h - 1, Math.floor(y / k)) * w + Math.min(w - 1, Math.floor(x / k))]!;
      small[y * sw + x] = v > 0.35 ? 1 : 0;
    }
  const label = new Int32Array(sw * sh);
  const sizes = [0];
  const stack: number[] = [];
  for (let i = 0; i < small.length; i++) {
    if (!small[i] || label[i]) continue;
    const id = sizes.length;
    let n = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const px = p % sw;
      const py = (p - px) / sw;
      for (const q of [
        px > 0 ? p - 1 : -1,
        px < sw - 1 ? p + 1 : -1,
        py > 0 ? p - sw : -1,
        py < sh - 1 ? p + sw : -1,
      ])
        if (q >= 0 && small[q] && !label[q]) {
          label[q] = id;
          stack.push(q);
        }
    }
    sizes.push(n);
  }
  const biggest = Math.max(0, ...sizes);
  if (biggest === 0) return;
  // Parts at least a tenth the size of the biggest stay (several people in a photo).
  const keep = sizes.map((n) => n >= biggest * 0.1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * k));
      const sy = Math.min(sh - 1, Math.floor(y * k));
      // Look round the pixel in the small copy, so the soft edge of a kept part stays.
      let ok = false;
      for (let dy = -1; dy <= 1 && !ok; dy++)
        for (let dx = -1; dx <= 1 && !ok; dx++) {
          const qx = sx + dx;
          const qy = sy + dy;
          if (qx < 0 || qy < 0 || qx >= sw || qy >= sh) continue;
          const l = label[qy * sw + qx]!;
          if (l && keep[l]) ok = true;
        }
      if (!ok) mask[y * w + x] = 0;
    }
}

/** Sums over a (2r+1)² box round every pixel, from a running-total table. */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]!;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + r + 1);
      const sum =
        sat[yb * (w + 1) + xb]! -
        sat[ya * (w + 1) + xb]! -
        sat[yb * (w + 1) + xa]! +
        sat[ya * (w + 1) + xa]!;
      out[y * w + x] = sum / ((yb - ya) * (xb - xa));
    }
  }
  return out;
}

/**
 * Fits the soft mask `p` to the photo's own edges: a guided filter (He, Sun & Tang) with the
 * photo's brightness as the guide. Where the photo has an edge, the mask's edge moves onto it.
 */
function guided(p: Float32Array, guide: Float32Array, w: number, h: number, r: number) {
  const eps = 0.004;
  const mI = boxMean(guide, w, h, r);
  const mP = boxMean(p, w, h, r);
  const ip = new Float32Array(w * h);
  const ii = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    ip[i] = guide[i]! * p[i]!;
    ii[i] = guide[i]! * guide[i]!;
  }
  const mIP = boxMean(ip, w, h, r);
  const mII = boxMean(ii, w, h, r);
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const cov = mIP[i]! - mI[i]! * mP[i]!;
    const v = mII[i]! - mI[i]! * mI[i]!;
    a[i] = cov / (v + eps);
    b[i] = mP[i]! - a[i]! * mI[i]!;
  }
  const mA = boxMean(a, w, h, r);
  const mB = boxMean(b, w, h, r);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.min(1, Math.max(0, mA[i]! * guide[i]! + mB[i]!));
  return out;
}

/** Sharpens the soft guess into a clean edge that still fades over a pixel or two. */
const edge = (p: number) => {
  const x = Math.min(1, Math.max(0, (p - 0.3) / 0.4));
  return x * x * (3 - 2 * x);
};

/**
 * Fills the masked hole of an image from the colours around it (push–pull): smaller and
 * smaller copies average only the known pixels, then each hole pixel takes the colour of
 * the copy just big enough to have one. Gives a soft, out-of-focus fill.
 */
function fillHole(rgba: Uint8ClampedArray, hole: Float32Array, w: number, h: number) {
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array };
  const base: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    const known = 1 - hole[i]!;
    base.a[i] = known;
    for (let k = 0; k < 3; k++) base.c[i * 3 + k] = rgba[i * 4 + k]! * known;
  }
  const levels: Level[] = [base];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const f = levels.at(-1)!;
    const nw = Math.max(1, Math.ceil(f.w / 2));
    const nh = Math.max(1, Math.ceil(f.h / 2));
    const n: Level = {
      w: nw,
      h: nh,
      c: new Float32Array(nw * nh * 3),
      a: new Float32Array(nw * nh),
    };
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let a = 0;
        const c = [0, 0, 0];
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(f.w - 1, x * 2 + dx);
            const sy = Math.min(f.h - 1, y * 2 + dy);
            const i = sy * f.w + sx;
            a += f.a[i]!;
            for (let k = 0; k < 3; k++) c[k]! += f.c[i * 3 + k]!;
          }
        const j = y * nw + x;
        // Colours stay weighted by how much of them is known; the weight is capped at 1.
        const s = a > 1 ? 1 / a : 1;
        n.a[j] = Math.min(1, a);
        for (let k = 0; k < 3; k++) n.c[j * 3 + k] = c[k]! * s;
      }
    levels.push(n);
  }
  // Back up: a pixel known only in part takes the rest from the level above it.
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l]!;
    const up = levels[l + 1]!;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const a = f.a[i]!;
        if (a >= 1) continue;
        // The coarser level, read smoothly (bilinear).
        const fx = Math.min(up.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const fy = Math.min(up.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(up.w - 1, x0 + 1);
        const y1 = Math.min(up.h - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        for (let k = 0; k < 3; k++) {
          const v =
            (up.c[(y0 * up.w + x0) * 3 + k]! * (1 - tx) + up.c[(y0 * up.w + x1) * 3 + k]! * tx) *
              (1 - ty) +
            (up.c[(y1 * up.w + x0) * 3 + k]! * (1 - tx) + up.c[(y1 * up.w + x1) * 3 + k]! * tx) *
              ty;
          f.c[i * 3 + k] = f.c[i * 3 + k]! + (1 - a) * v;
        }
        f.a[i] = 1;
      }
  }
  // A little grain so the filled part doesn't look flatter than the photo round it.
  for (let i = 0; i < w * h; i++) {
    const t = hole[i]!;
    if (t <= 0) continue;
    const grain = (Math.random() - 0.5) * 6 * t;
    for (let k = 0; k < 3; k++)
      rgba[i * 4 + k] = rgba[i * 4 + k]! * (1 - t) + (base.c[i * 3 + k]! + grain) * t;
  }
}

async function encode(canvas: HTMLCanvasElement, see: boolean) {
  let blob = see
    ? await canvasToBlob(canvas, 'image/webp', 0.9)
    : await canvasToBlob(canvas, 'image/jpeg', 0.86);
  if (see && (!blob || blob.type !== 'image/webp')) blob = await canvasToBlob(canvas, 'image/png');
  return blob;
}

/**
 * The people of a photo on a see-through background, and the photo without them (the hole
 * filled), both the photo's size so their layers line up exactly over each other.
 * `found` is false when no one was found.
 */
export async function cutOutPeople(
  src: Blob | string,
  onStage?: (stage: 'loading' | 'working') => void,
): Promise<{ people: Blob; background: Blob; ratio: number; found: boolean }> {
  onStage?.(cutoutReady() ? 'working' : 'loading');
  const model = await segmenter();
  onStage?.('working');
  const img = await imageOf(src);
  let side = 1400;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);

    // 1–2: the whole photo, then a closer look at where the people are.
    let mask = personMask(model, canvas, w, h);
    const box = bounds(mask, w, h);
    if (box) {
      const pad = Math.round(Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.12) + 8;
      const cx0 = Math.max(0, box.x0 - pad);
      const cy0 = Math.max(0, box.y0 - pad);
      const cx1 = Math.min(w, box.x1 + pad);
      const cy1 = Math.min(h, box.y1 + pad);
      const cw = cx1 - cx0;
      const ch = cy1 - cy0;
      if (cw * ch < w * h * 0.7 && cw > 16 && ch > 16) {
        const crop = document.createElement('canvas');
        crop.width = cw;
        crop.height = ch;
        crop.getContext('2d')!.drawImage(canvas, cx0, cy0, cw, ch, 0, 0, cw, ch);
        const near = personMask(model, crop, cw, ch);
        freeCanvas(crop);
        const next = new Float32Array(w * h);
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            // Fades to the first look near the crop's edge, so no seam shows.
            const edgeDist = Math.min(x, y, cw - 1 - x, ch - 1 - y);
            const t = Math.min(1, edgeDist / 6);
            const i = (y + cy0) * w + x + cx0;
            next[i] = near[y * cw + x]! * t + mask[i]! * (1 - t);
          }
        mask = next;
      }
    }
    // 3: no stray specks.
    dropSpecks(mask, w, h);
    // 4: the edge onto the photo's own edges.
    const pixels = ctx.getImageData(0, 0, w, h);
    const guide = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      guide[i] =
        (0.299 * pixels.data[i * 4]! +
          0.587 * pixels.data[i * 4 + 1]! +
          0.114 * pixels.data[i * 4 + 2]!) /
        255;
    const r = Math.max(2, Math.round(Math.min(w, h) / 180));
    const fitted = guided(mask, guide, w, h, r);

    let kept = 0;
    const alpha = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const a = edge(fitted[i]!);
      alpha[i] = a;
      if (a > 0.5) kept++;
    }
    const found = kept > w * h * 0.005;

    // The people.
    const people = new ImageData(new Uint8ClampedArray(pixels.data), w, h);
    for (let i = 0; i < w * h; i++) people.data[i * 4 + 3] = Math.round(255 * alpha[i]!);
    ctx.putImageData(people, 0, 0);
    const peopleBlob = await encode(canvas, true);

    // 5: the background without them: the hole (a little wider than the people) filled.
    const hole = new Float32Array(w * h);
    // Wide enough to take the soft fringe (hair, motion blur) the outline left outside.
    const grow = boxMean(mask, w, h, Math.max(4, Math.round(Math.min(w, h) / 40)));
    for (let i = 0; i < w * h; i++) hole[i] = Math.min(1, Math.max(alpha[i]!, grow[i]! * 3));
    const back = new ImageData(new Uint8ClampedArray(pixels.data), w, h);
    fillHole(back.data, hole, w, h);
    for (let i = 0; i < w * h; i++) back.data[i * 4 + 3] = 255;
    ctx.putImageData(back, 0, 0);
    const backBlob = await encode(canvas, false);
    freeCanvas(canvas);

    if (
      peopleBlob &&
      backBlob &&
      peopleBlob.size <= MEDIA_MAX_BYTES &&
      backBlob.size <= MEDIA_MAX_BYTES
    )
      return { people: peopleBlob, background: backBlob, ratio: w / h, found };
    side = Math.round(side * 0.75);
  }
  throw new Error('too large');
}
