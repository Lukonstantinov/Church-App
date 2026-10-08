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
  try {
    const { toJpeg } = await import('html-to-image');
    await picturesReady(node);
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
        // A first small drawing loads everything into the copy (iPhones draw pictures only
        // from the second time on); it is thrown away.
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
  }
  return null;
}
