import { MEDIA_MAX_BYTES } from '@church/shared';

/** Waits until every picture in the poster has loaded and decoded (or failed). */
async function picturesReady(node: HTMLElement): Promise<void> {
  const imgs = [...node.querySelectorAll('img')];
  await Promise.all(
    imgs.map((img) =>
      (img.complete
        ? Promise.resolve()
        : new Promise((r) => img.addEventListener('load', r, { once: true }))
      )
        .then(() => img.decode?.())
        .catch(() => undefined),
    ),
  );
}

/**
 * Swaps every picture in the poster for a plain PNG copy that is already decoded, and
 * returns how to put the originals back. iPhones often leave photos out of the drawing when
 * they come straight from their files (WebP, or not decoded yet when the drawing is made);
 * a ready PNG is drawn every time. Big photos are scaled to what the poster needs.
 */
async function inlinePictures(node: HTMLElement): Promise<() => void> {
  const swaps: { img: HTMLImageElement; src: string; srcset: string; style?: string }[] = [];
  for (const img of [...node.querySelectorAll('img')]) {
    if (!img.currentSrc && !img.src) continue;
    if (img.src.startsWith('data:')) continue;
    try {
      if (!img.complete) await new Promise((r) => img.addEventListener('load', r, { once: true }));
      await img.decode().catch(() => undefined);
      if (!img.naturalWidth) continue;
      // A faded speaker photo: crop and fade drawn into the copy itself, no mask needed.
      if (img.dataset.fade) {
        const data = fadedCopy(img);
        if (data) {
          swaps.push({ img, src: img.src, srcset: img.srcset, style: img.style.cssText });
          img.srcset = '';
          img.src = data;
          img.style.maskImage = 'none';
          img.style.webkitMaskImage = 'none';
          img.style.objectFit = 'fill';
          await img.decode().catch(() => undefined);
          continue;
        }
      }
      const box = img.getBoundingClientRect();
      // Enough for a sharp poster (drawn at up to twice its size), never more than the photo.
      const want = Math.max(box.width, box.height, 64) * 2.5;
      const scale = Math.min(
        1,
        1400 / Math.max(img.naturalWidth, img.naturalHeight),
        want / Math.min(img.naturalWidth, img.naturalHeight) || 1,
      );
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/png');
      swaps.push({ img, src: img.src, srcset: img.srcset });
      img.srcset = '';
      img.src = data;
      await img.decode().catch(() => undefined);
    } catch {
      // A picture that can't be copied is drawn as it is.
    }
  }
  return () => {
    for (const s of swaps) {
      s.img.src = s.src;
      s.img.srcset = s.srcset;
      if (s.style !== undefined) s.img.style.cssText = s.style;
    }
  };
}

/**
 * A speaker photo as it shows on the poster — cropped like `object-fit: cover` to its box
 * (keeping the top, middle or bottom in view) and fading out towards the poster's middle —
 * as one PNG. Null when it can't be drawn.
 */
function fadedCopy(img: HTMLImageElement): string | null {
  // The box in poster pixels (unscaled), drawn at twice that for a sharp picture.
  const bw = img.offsetWidth;
  const bh = img.offsetHeight;
  if (!bw || !bh) return null;
  const k = Math.min(2, 1400 / Math.max(bw, bh));
  const w = Math.round(bw * k);
  const h = Math.round(bh * k);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const fit = Math.max(bw / iw, bh / ih);
  const sw = bw / fit;
  const sh = bh / fit;
  const pos = img.dataset.pos;
  const sy = pos === 'top' ? 0 : pos === 'bottom' ? ih - sh : (ih - sh) / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, (iw - sw) / 2, sy, sw, sh, 0, 0, w, h);
  // Keep the photo only where the fade lets it through (the same fade as on screen).
  ctx.globalCompositeOperation = 'destination-in';
  const side = img.dataset.fade;
  if (side === 'center') {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale((w / 2) * Math.SQRT2, (h / 2) * Math.SQRT2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0.4, '#000');
    g.addColorStop(0.72, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  } else {
    const g =
      side === 'left' ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(w, 0, 0, 0);
    g.addColorStop(0, '#000');
    g.addColorStop(0.45, '#000');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  return c.toDataURL('image/png');
}

/**
 * Whether a drawn poster came out blank (one flat colour, or black where its photo should
 * be — on iPhones a drawing can miss its pictures, and a JPEG turns the gaps black).
 */
async function looksBlank(dataUrl: string): Promise<boolean> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let min = 255;
    let max = 0;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v < 14) dark++;
    }
    // One flat colour, or nearly all pitch black (a missing photo with only the title on it).
    return max - min < 12 || dark > 0.88 * (d.length / 4);
  } catch {
    return false;
  }
}

/**
 * Draws a rendered cover as a JPEG small enough to upload (the bot sends it as a
 * picture). Lowers the size and quality until it fits; null when it can't be drawn — or
 * comes out blank, so the bot sends the cover photo instead of a black square.
 */
export async function capturePoster(node: HTMLElement, sharp = false): Promise<Blob | null> {
  let restore: (() => void) | undefined;
  try {
    const { toJpeg } = await import('html-to-image');
    await picturesReady(node);
    restore = await inlinePictures(node);
    // Moving effects stay out of the still picture: those blending with what is under them
    // (smoke, light leaks…) can't be drawn into it and would come out as black patches.
    node.classList.add('capturing');
    const attempts = [
      ...(sharp
        ? ([
            [2, 0.88],
            [2, 0.72],
          ] as const)
        : []),
      [1.5, 0.85],
      [1.5, 0.7],
      [1, 0.7],
      [1, 0.5],
    ] as const;
    for (const skipFonts of [false, true]) {
      try {
        // Two first small drawings load everything into the copy (iPhones draw pictures only
        // from the second or third time on); they are thrown away.
        for (let i = 0; i < 2; i++)
          await toJpeg(node, { pixelRatio: 0.25, quality: 0.3, skipFonts }).catch(() => undefined);
        for (const [pixelRatio, quality] of attempts) {
          let dataUrl = await toJpeg(node, { pixelRatio, quality, skipFonts });
          if (await looksBlank(dataUrl)) {
            // Once more after a moment; still blank = no poster rather than a black one.
            await new Promise((r) => setTimeout(r, 400));
            dataUrl = await toJpeg(node, { pixelRatio, quality, skipFonts });
            if (await looksBlank(dataUrl)) return null;
          }
          const blob = await (await fetch(dataUrl)).blob();
          if (blob.size <= MEDIA_MAX_BYTES) return blob;
        }
        return null;
      } catch {
        // Embedding the fonts failed: try again without them.
      }
    }
  } catch {
    // No poster is better than no save.
  } finally {
    node.classList.remove('capturing');
    restore?.();
  }
  return null;
}
