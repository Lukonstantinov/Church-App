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

function applyColorScheme() {
  const scheme = webApp()?.colorScheme;
  if (scheme) document.documentElement.dataset.theme = scheme;
}

export function initTelegram(): void {
  const tg = webApp();
  if (!tg?.initData) {
    // Plain browser (development): follow the OS theme.
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  if (!tg) return;
  tg.ready();
  tg.expand();
  applyColorScheme();
  tg.onEvent?.('themeChanged', applyColorScheme);
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

/** Native confirm dialog inside Telegram; window.confirm elsewhere. */
export function confirmDialog(message: string): Promise<boolean> {
  const tg = webApp();
  if (tg?.showConfirm) {
    return new Promise((resolve) => {
      try {
        tg.showConfirm(message, (ok) => resolve(ok));
      } catch {
        resolve(window.confirm(message));
      }
    });
  }
  return Promise.resolve(window.confirm(message));
}

/** Opens Telegram's "share to chat" sheet for a link. */
export function shareLink(url: string, text: string): void {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const tg = webApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else window.open(share, '_blank');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Opens WhatsApp with the text prefilled; the user picks the chat (free, no API). */
export function shareToWhatsApp(text: string): void {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const tg = webApp();
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}

/** Opens Telegram's "forward to chat" picker with the text. */
export function shareToTelegram(text: string): void {
  const url = `https://t.me/share/url?url=${encodeURIComponent(text)}`;
  const tg = webApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}
