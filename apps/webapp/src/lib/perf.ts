/**
 * Keeping the animations light on phones: one shared watcher pauses everything that is
 * off screen, and weaker phones get a "lite" mode (fewer particles, no heavy filters).
 */

/** A phone with few cores or little memory: animations are thinned out there. */
export const LITE =
  typeof navigator !== 'undefined' &&
  ((navigator.hardwareConcurrency ?? 8) <= 4 ||
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 3);

if (LITE && typeof document !== 'undefined') document.documentElement.dataset.lite = 'true';

let io: IntersectionObserver | null = null;

/**
 * Marks the element `data-off` while it is out of view (with a little margin), which the
 * CSS uses to pause its animations. Returns the function that stops watching.
 */
export function watchOffscreen(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        (e.target as HTMLElement).toggleAttribute('data-off', !e.isIntersecting);
    },
    { rootMargin: '120px' },
  );
  io.observe(el);
  return () => io?.unobserve(el);
}
