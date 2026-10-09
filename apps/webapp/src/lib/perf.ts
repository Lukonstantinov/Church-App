import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { storage } from './storage';

/**
 * Keeping the animations light on phones.
 *
 * Each phone has a graphics quality: full, lite (fewer particles, one animation per block,
 * no heavy filters, shine or flowing backgrounds) or still (designs stay, nothing moves —
 * the animation layers aren't even drawn). The person picks it in «Ещё»; on "auto" the app
 * starts from what the phone looks like and steps down by itself when frames drop.
 *
 * On top of that: animations off screen are paused, only a few animated blocks run at
 * once, and everything holds still while the page is being scrolled.
 */

export type Quality = 'full' | 'lite' | 'still';
export type QualityChoice = 'auto' | Quality;
export const QUALITY_CHOICES: QualityChoice[] = ['auto', 'full', 'lite', 'still'];

const KEY = 'church.quality';
/** What "auto" settled on for this phone (it only ever steps down). */
const AUTO_KEY = 'church.quality.auto';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** A phone with few cores or little memory starts in lite. */
const weakPhone =
  typeof navigator !== 'undefined' &&
  ((navigator.hardwareConcurrency ?? 8) <= 4 ||
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 3);

const isQuality = (v: unknown): v is Quality => v === 'full' || v === 'lite' || v === 'still';

export function getQualityChoice(): QualityChoice {
  const v = storage.get(KEY);
  return v === 'auto' || isQuality(v) ? v : 'auto';
}

/** What "auto" uses on this phone right now. */
export function getAutoQuality(): Quality {
  const v = storage.get(AUTO_KEY);
  return isQuality(v) ? v : weakPhone ? 'lite' : 'full';
}

/**
 * A start that never settled: the app closed itself (an iPhone runs out of memory on a
 * heavy page and shows an empty screen, again on every try). This start then runs still,
 * just this once, and says so; the person's own setting stays as it was.
 */
const BOOT_KEY = 'church.booting';
let safeStart = false;

/** This start runs still because the last one crashed. */
export const isSafeStart = () => safeStart;

function watchBoot() {
  safeStart = storage.get(BOOT_KEY) !== null;
  storage.set(BOOT_KEY, String(Date.now()));
  // Settled: shown for a few seconds, or hidden / closed normally (a crash does neither).
  const settled = () => storage.remove(BOOT_KEY);
  setTimeout(settled, 8000);
  window.addEventListener('pagehide', settled);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') settled();
  });
}

/** The quality in effect. */
export function getQuality(): Quality {
  if (safeStart) return 'still';
  const c = getQualityChoice();
  return c === 'auto' ? getAutoQuality() : c;
}

/** Puts the quality on <html> so the CSS can follow it. */
export function applyQuality(): void {
  const q = getQuality();
  const html = document.documentElement;
  html.dataset.quality = q;
  // The lite rules apply to "still" too (it is lighter still).
  if (q === 'full') delete html.dataset.lite;
  else html.dataset.lite = 'true';
  budget = q === 'full' ? 6 : 3;
  rebalance();
}

export function setQualityChoice(c: QualityChoice): void {
  storage.set(KEY, c);
  safeStart = false;
  // Choosing "auto" again gives the phone a fresh chance.
  if (c === 'auto') storage.remove(AUTO_KEY);
  applyQuality();
  notify();
}

export const useQuality = () =>
  useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getQuality);

/**
 * A copy drawn to be recorded as a moving picture (lib/recorder.ts): its animation layers
 * are drawn in full whatever this phone's graphics setting is.
 */
export const FullMotion = createContext(false);

/**
 * Whether these animation layers are a design preview or a copy to record (FullMotion):
 * they always run, outside the limit on how many run at once — what is being designed
 * must be seen moving (a moving gradient stood still in the poster editor).
 */
export const useUnlimited = () => useContext(FullMotion);

/** The quality the animation layers use here: full inside a recorded copy. */
export function useEffectQuality(): Quality {
  const forced = useContext(FullMotion);
  const q = useQuality();
  return forced ? 'full' : q;
}

export const useQualityChoice = () =>
  useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getQualityChoice);

// ---------- Off screen, and only a few at once ----------

let io: IntersectionObserver | null = null;
/** How many animation layers may run at the same time. */
let budget = 6;
/** Layers in view, in the order they came into view. */
const visible = new Set<Element>();
const budgeted = new WeakSet<Element>();
/** How big each layer is on screen (a big meeting panel matters more than a small button). */
const areas = new WeakMap<Element, number>();

/**
 * Runs the `budget` biggest visible animation layers; the rest wait (data-off). By size,
 * not by arrival: the header and a row of small buttons came first and used up the whole
 * budget, so the meeting panel and tiles below stood still.
 */
function rebalance() {
  const ranked = [...visible]
    .filter((el) => budgeted.has(el))
    .sort((a, b) => (areas.get(b) ?? 0) - (areas.get(a) ?? 0));
  ranked.forEach((el, n) => el.toggleAttribute('data-off', n >= budget));
}

/**
 * Marks the element `data-off` while it is out of view (with a little margin), which the
 * CSS uses to pause its animations. With `limited`, it also counts against the number of
 * animation layers allowed to run at once. Returns the function that stops watching.
 */
export function watchOffscreen(el: Element, limited = false): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  if (limited) budgeted.add(el);
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        areas.set(e.target, e.boundingClientRect.width * e.boundingClientRect.height);
        if (e.isIntersecting) visible.add(e.target);
        else {
          visible.delete(e.target);
          e.target.setAttribute('data-off', '');
        }
        if (!budgeted.has(e.target)) e.target.toggleAttribute('data-off', !e.isIntersecting);
      }
      rebalance();
    },
    { rootMargin: '120px' },
  );
  io.observe(el);
  return () => {
    io?.unobserve(el);
    visible.delete(el);
    rebalance();
  };
}

// ---------- Mounted only near the screen ----------

let nearIo: IntersectionObserver | undefined;
const nearCallbacks = new WeakMap<Element, (near: boolean) => void>();

/**
 * Whether an element is on or near the screen. Long lists of live previews (the animation
 * picker has about fifty) draw only the ones in view: all of them at once took more memory
 * than an iPhone gives the app, and Telegram showed a blank page.
 */
export function useNearScreen(ref: RefObject<Element | null>): boolean {
  // Without the observer (very old phones) everything is drawn, as before.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    nearIo ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) nearCallbacks.get(e.target)?.(e.isIntersecting);
      },
      { rootMargin: '150px' },
    );
    nearCallbacks.set(el, setNear);
    nearIo.observe(el);
    return () => {
      nearIo?.unobserve(el);
      nearCallbacks.delete(el);
    };
  }, [ref]);
  return near;
}

// ---------- Still while scrolling ----------

/** Pauses all animations while the page scrolls, so scrolling itself stays smooth. */
function watchScrolling() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const html = document.documentElement;
  window.addEventListener(
    'scroll',
    () => {
      if (!timer) html.dataset.scrolling = 'true';
      clearTimeout(timer);
      timer = setTimeout(() => {
        delete html.dataset.scrolling;
        timer = undefined;
      }, 180);
    },
    { passive: true, capture: true },
  );
}

// ---------- Auto: step down when the phone struggles ----------

/** Fired (on window) when "auto" lowered the quality, so the app can say so once. */
export const QUALITY_LOWERED = 'church:quality-lowered';

/**
 * Now and then, while animations are on screen and the page isn't scrolling, counts the
 * frames drawn over two seconds. Two slow samples in a row (under 28 per second) step
 * "auto" down: full → lite → still.
 */
function watchFrames() {
  let slow = 0;
  // A phone that keeps up gets checked less and less often (the check itself costs a little).
  let wait = 6000;
  const sample = () => {
    if (getQualityChoice() !== 'auto' || getQuality() === 'still') return;
    const html = document.documentElement;
    if (document.hidden || html.dataset.scrolling || visible.size === 0) {
      setTimeout(sample, 4000);
      return;
    }
    let frames = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - t0 < 2000) requestAnimationFrame(tick);
      else {
        // Scrolling or hiding during the sample makes it meaningless.
        const fair = !document.hidden && !html.dataset.scrolling;
        const fps = (frames * 1000) / (now - t0);
        // 30 a second is smooth enough; only below that does it step down.
        if (fair) slow = fps < 28 ? slow + 1 : 0;
        wait = slow ? 4000 : Math.min(wait * 1.5, 60000);
        if (slow >= 2) {
          slow = 0;
          storage.set(AUTO_KEY, getQuality() === 'full' ? 'lite' : 'still');
          applyQuality();
          notify();
          window.dispatchEvent(new Event(QUALITY_LOWERED));
        }
        setTimeout(sample, wait);
      }
    };
    requestAnimationFrame(tick);
  };
  setTimeout(sample, 3000);
}

// ---------- 30 frames a second for decorative animations ----------

/** How many times a second the long decorative animations change (lite phones: fewer). */
const capFps = () => (getQuality() === 'full' ? 30 : 24);
const capped = new WeakSet<Animation>();

/**
 * Puts every long-running decorative animation (drifts, particles, flames, edges — not the
 * short ones of opening sheets or pressing buttons) on a beat of 30 a second: its time moves
 * in steps, so between beats nothing changes and the phone has nothing new to draw. Half
 * the drawing work, and at these speeds it looks the same.
 */
function capAnimations() {
  const fps = capFps();
  for (const a of document.getAnimations()) {
    if (capped.has(a) || typeof CSSAnimation === 'undefined' || !(a instanceof CSSAnimation))
      continue;
    capped.add(a);
    const effect = a.effect;
    if (!effect) continue;
    const ms = Number(effect.getTiming().duration);
    if (!Number.isFinite(ms) || ms < 1200 || effect.getTiming().iterations !== Infinity) continue;
    // Faster playback (the speed setting) means more steps per cycle for the same beat.
    const steps = Math.max(2, Math.round(((ms / 1000) * fps) / Math.abs(a.playbackRate || 1)));
    effect.updateTiming({ easing: `steps(${steps})` });
  }
}

function watchAnimations() {
  // New animations appear as screens open; checking every 1.5 s is plenty and costs little.
  setInterval(() => {
    if (!document.hidden) capAnimations();
  }, 1500);
  setTimeout(capAnimations, 300);
}

/** Called once at start-up. */
export function startPerformanceWatch(): void {
  watchBoot();
  applyQuality();
  watchScrolling();
  watchFrames();
  watchAnimations();
}
