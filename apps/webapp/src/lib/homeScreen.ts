import { useEffect, useState } from 'react';
import { webApp } from './telegram';

export type HomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed';

/**
 * Telegram's own "add to home screen" (Bot API 8.0+): a phone shortcut that opens the
 * Mini App directly. The status says whether it is there already, missing, or the
 * Telegram app is too old to do it.
 */
export function useHomeScreen(on?: { added?: () => void; failed?: () => void }) {
  const [status, setStatus] = useState<HomeScreenStatus>(() => {
    const tg = webApp();
    return tg?.checkHomeScreenStatus && tg.isVersionAtLeast?.('8.0') ? 'unknown' : 'unsupported';
  });
  useEffect(() => {
    const tg = webApp();
    if (!tg?.checkHomeScreenStatus || !tg.isVersionAtLeast?.('8.0')) return;
    const onAdded = () => {
      setStatus('added');
      on?.added?.();
    };
    const onFailed = () => on?.failed?.();
    // The typings don't list "homeScreenFailed" yet; Telegram sends it when adding fails.
    const events = tg as unknown as {
      onEvent: (e: string, cb: () => void) => void;
      offEvent?: (e: string, cb: () => void) => void;
    };
    try {
      tg.checkHomeScreenStatus((s) => setStatus(s));
      events.onEvent('homeScreenAdded', onAdded);
      events.onEvent('homeScreenFailed', onFailed);
    } catch {
      // An older client without the call: the button simply stays.
    }
    return () => {
      events.offEvent?.('homeScreenAdded', onAdded);
      events.offEvent?.('homeScreenFailed', onFailed);
    };
    // The callbacks only show a message; subscribing once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const add = () => {
    try {
      webApp()?.addToHomeScreen();
    } catch {
      setStatus('unsupported');
    }
  };
  /** Which steps to show: iPhone goes through Safari, Android asks Telegram directly. */
  const platform = webApp()?.platform;
  const os: 'ios' | 'android' | 'other' =
    platform === 'ios' || platform === 'macos'
      ? 'ios'
      : platform === 'android' || platform === 'android_x'
        ? 'android'
        : 'other';
  return { status, add, os };
}
