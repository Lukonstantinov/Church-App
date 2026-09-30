import { LOGO_MAX_BYTES } from '@church/shared';

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
