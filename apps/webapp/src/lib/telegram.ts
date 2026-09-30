/** Thin wrapper around the official Telegram WebApp bridge (window.Telegram.WebApp). */
import type { WebApp } from 'telegram-web-app';

export function webApp(): WebApp | undefined {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
}

/**
 * Raw signed initData to send to the API. Outside Telegram it is empty, except in
 * `vite dev` where VITE_DEV_INIT_DATA can hold a locally signed value.
 */
export function initDataRaw(): string {
  const fromTelegram = webApp()?.initData;
  if (fromTelegram) return fromTelegram;
  if (import.meta.env.DEV) return import.meta.env.VITE_DEV_INIT_DATA ?? '';
  return '';
}

export function isInsideTelegram(): boolean {
  return initDataRaw() !== '';
}

/** Parameter from t.me/<bot>?startapp=<param>, e.g. "roll_12". */
export function startParam(): string | null {
  return webApp()?.initDataUnsafe?.start_param ?? null;
}

export function initTelegram(): void {
  const tg = webApp();
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor('secondary_bg_color');
    tg.setBackgroundColor('secondary_bg_color');
  } catch {
    // Older clients don't support these; harmless.
  }
}

export const haptic = {
  success: () => webApp()?.HapticFeedback?.notificationOccurred('success'),
  error: () => webApp()?.HapticFeedback?.notificationOccurred('error'),
  tap: () => webApp()?.HapticFeedback?.selectionChanged(),
};
