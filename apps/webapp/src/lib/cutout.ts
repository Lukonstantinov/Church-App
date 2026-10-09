import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { MEDIA_MAX_BYTES } from '@church/shared';
import { canvasToBlob } from './image';
import { freeCanvas } from './poster';

/**
 * Background removal on the phone: Google's MediaPipe "selfie multiclass" model (free,
 * Apache 2.0) finds the people in a photo and everything else becomes see-through. The
 * photo never leaves the phone for this; the engine (WebAssembly, copied into the app at
 * build) and the model (16 MB, relayed by our server: /media/model/…) are downloaded once
 * and then come from the phone's cache. Made for people — objects without people in front
 * aren't found.
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

/** Whether the model is already on this phone's memory (no download wait). */
export const cutoutReady = () => loading !== null;

async function imageOf(src: Blob | string): Promise<HTMLImageElement> {
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

/** Sharpens the model's soft guess into a clean edge that still fades over a pixel or two. */
const edge = (p: number) => {
  const x = Math.min(1, Math.max(0, (p - 0.25) / 0.5));
  return x * x * (3 - 2 * x);
};

/**
 * The people of a photo on a see-through background, the same size as the photo (so a
 * layer of it lines up exactly over the photo). `found` is false when no one was found.
 */
export async function removeBackground(
  src: Blob | string,
  onStage?: (stage: 'loading' | 'working') => void,
): Promise<{ blob: Blob; ratio: number; found: boolean }> {
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
    // Category 0 is the background; its confidence, upscaled to the photo, says how
    // see-through each pixel becomes.
    const result = model.segment(canvas);
    const back = result.confidenceMasks?.[0];
    if (!back) {
      result.close();
      freeCanvas(canvas);
      throw new Error('no mask');
    }
    const mask = back.getAsFloat32Array();
    const mw = back.width;
    const mh = back.height;
    const pixels = ctx.getImageData(0, 0, w, h);
    let kept = 0;
    for (let y = 0; y < h; y++) {
      const my = Math.min(mh - 1, Math.floor((y * mh) / h));
      for (let x = 0; x < w; x++) {
        const mx = Math.min(mw - 1, Math.floor((x * mw) / w));
        const a = edge(1 - mask[my * mw + mx]!);
        const i = (y * w + x) * 4 + 3;
        pixels.data[i] = Math.round(pixels.data[i]! * a);
        if (a > 0.5) kept++;
      }
    }
    result.close();
    ctx.putImageData(pixels, 0, 0);
    let blob = await canvasToBlob(canvas, 'image/webp', 0.9);
    if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/png');
    freeCanvas(canvas);
    if (blob && blob.size <= MEDIA_MAX_BYTES)
      return { blob, ratio: w / h, found: kept > w * h * 0.01 };
    side = Math.round(side * 0.75);
  }
  throw new Error('too large');
}
