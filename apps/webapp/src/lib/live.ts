import { useSyncExternalStore } from 'react';

/** An event or meeting with no end time is taken to run this long. */
export const LIVE_FALLBACK_MS = 3 * 3_600_000;

/** Whether something that starts at `startsAt` is going on now (until `endsAt`, or a few hours). */
export function isLiveWindow(
  startsAt: string,
  endsAt: string | null | undefined,
  now = Date.now(),
): boolean {
  const start = Date.parse(startsAt);
  const end = endsAt ? Date.parse(endsAt) : start + LIVE_FALLBACK_MS;
  return now >= start && now < Math.max(end, start + 60_000);
}

// One timer for every counter on screen, ticking each second.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(cb: () => void) {
  listeners.add(cb);
  timer ??= setInterval(() => listeners.forEach((l) => l()), 1000);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
const nowSecond = () => Math.floor(Date.now() / 1000);
export const useNowSecond = () => useSyncExternalStore(subscribe, nowSecond);
