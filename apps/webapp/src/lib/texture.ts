import { useEffect, useState } from 'react';

/**
 * Noise textures (smoke, frost, grain, foil, grunge…) are SVG pictures with noise filters.
 * Drawn as they are, iPhones redo the filter whenever a layer moves, turns or scales, and
 * several of them at once (two smokes on a pinned event) can run the phone out of memory:
 * the app closes itself and shows an empty screen. Each texture is therefore drawn once into
 * an ordinary picture, shared by every layer that uses it.
 */
const pictures = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const KEEP = 32;

/** `url("data:image/svg+xml,…")` → `url("blob:…")` of the same picture as a PNG. */
function draw(css: string): Promise<string> {
  const known = pending.get(css);
  if (known) return known;
  const job = (async () => {
    const src = /^url\("(.*)"\)$/s.exec(css)?.[1];
    if (!src) return css;
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 300;
      c.height = img.naturalHeight || 300;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      // Its memory back straight away (iPhones allow only so much canvas memory).
      c.width = 0;
      c.height = 0;
      // A phone that can't draw it keeps the SVG.
      return blob ? `url("${URL.createObjectURL(blob)}")` : css;
    } catch {
      return css;
    }
  })().then((out) => {
    pictures.set(css, out);
    // Dragging a colour slider makes a new texture per step: the oldest ones are let go.
    while (pictures.size > KEEP) {
      const [old, url] = pictures.entries().next().value!;
      pictures.delete(old);
      pending.delete(old);
      if (url.startsWith('url("blob:')) URL.revokeObjectURL(url.slice(5, -2));
    }
    return out;
  });
  pending.set(css, job);
  return job;
}

/**
 * The texture as a picture for `background-image`. Nothing until it is drawn (a moment
 * on first use; then straight away), so the heavy SVG is never shown.
 */
export function useTexture(css: string | null): string | undefined {
  const [, redraw] = useState(0);
  const ready = css ? pictures.get(css) : undefined;
  useEffect(() => {
    if (!css || pictures.has(css)) return;
    let live = true;
    void draw(css).then(() => live && redraw((n) => n + 1));
    return () => {
      live = false;
    };
  }, [css]);
  return ready;
}
