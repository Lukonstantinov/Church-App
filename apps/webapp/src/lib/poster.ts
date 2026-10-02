import { MEDIA_MAX_BYTES } from '@church/shared';

/**
 * Draws a rendered cover as a JPEG small enough to upload (the bot sends it as a
 * picture). Lowers the size and quality until it fits; null when it can't be drawn.
 */
export async function capturePoster(node: HTMLElement): Promise<Blob | null> {
  try {
    const { toJpeg } = await import('html-to-image');
    const attempts = [
      [1.5, 0.85],
      [1.5, 0.7],
      [1, 0.7],
      [1, 0.5],
    ] as const;
    for (const skipFonts of [false, true]) {
      try {
        for (const [pixelRatio, quality] of attempts) {
          const dataUrl = await toJpeg(node, { pixelRatio, quality, skipFonts });
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
  }
  return null;
}
