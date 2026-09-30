import { LOGO_MAX_BYTES, MEDIA_MAX_BYTES } from '@church/shared';

const SIZE = 256;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Turns any picked image (PNG, JPG, WebP, SVG…) into a small square-fitted raster
 * logo. SVGs are rasterised here, so the server only ever stores PNG/WebP bytes.
 */
export async function prepareLogo(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable image'));
      el.src = url;
    });
    const w = img.naturalWidth || SIZE;
    const h = img.naturalHeight || SIZE;
    const scale = Math.min(SIZE / w, SIZE / h, 1) || 1;
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch);

    // WebP where the browser can encode it (smaller); PNG otherwise (keeps transparency).
    let blob = await canvasToBlob(canvas, 'image/webp', 0.9);
    if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/png');
    if (!blob) throw new Error('encode failed');
    if (blob.size > LOGO_MAX_BYTES) throw new Error('too large');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Shrinks a phone photo (receipt, event picture) to at most 1600 px on the long side and
 * re-encodes it (WebP, else JPEG), lowering quality until it fits the upload limit.
 */
export async function preparePhoto(file: File, maxSide = 1600): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable image'));
      el.src = url;
    });
    let side = maxSide;
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = img.naturalWidth || side;
      const h = img.naturalHeight || side;
      const scale = Math.min(side / w, side / h, 1) || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; // transparent PNGs → white, not black, in JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const quality = attempt < 3 ? 0.82 - attempt * 0.12 : 0.6;
      let blob = await canvasToBlob(canvas, 'image/webp', quality);
      if (!blob || blob.type !== 'image/webp')
        blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (blob && blob.size <= MEDIA_MAX_BYTES) return blob;
      if (attempt >= 2) side = Math.round(side * 0.75);
    }
    throw new Error('too large');
  } finally {
    URL.revokeObjectURL(url);
  }
}
