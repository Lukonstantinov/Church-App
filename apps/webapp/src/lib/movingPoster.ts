import { LOOP_MAX_BYTES } from '@church/shared';
import { uploadLoop } from './queries';

/**
 * Records a poster with its effects as a short looping video and stores it for the
 * ministry, for a reminder or an announcement to send (it plays like a GIF in Telegram).
 * A stored video must stay small: if it comes out too big it is made again narrower and
 * lighter. Null when this phone can't make videos or the poster doesn't move.
 */
export async function recordPosterVideo(
  node: HTMLElement,
  groupId: number,
  onProgress?: (done: number) => void,
): Promise<number | null> {
  const { hasEffects, recordLoop } = await import('./recorder');
  if (!hasEffects(node)) return null;
  for (const [width, quality] of [
    [720, 0.09],
    [600, 0.06],
    [480, 0.045],
  ] as const) {
    const rec = await recordLoop(node, { width, quality, onProgress });
    if (!rec.mp4) return null;
    if (rec.mp4.size <= LOOP_MAX_BYTES) return (await uploadLoop(groupId, rec.mp4)).id;
  }
  return null;
}
