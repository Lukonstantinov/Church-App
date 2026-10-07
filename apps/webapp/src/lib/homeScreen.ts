import { useEffect, useState } from 'react';
import { webApp } from './telegram';

export type HomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed';

/**
 * Telegram's own "add to home screen" (Bot API 8.0+): a phone shortcut that opens the
 * Mini App directly. The status says whether it is there already, missing, or the
 * Telegram app is too old to do it.
 */
export function useHomeScreen() {
  const [status, setStatus] = useState<HomeScreenStatus>(() => {
    const tg = webApp();
    return tg?.checkHomeScreenStatus && tg.isVersionAtLeast?.('8.0') ? 'unknown' : 'unsupported';
  });
  useEffect(() => {
    const tg = webApp();
    if (!tg?.checkHomeScreenStatus || !tg.isVersionAtLeast?.('8.0')) return;
    const onAdded = () => setStatus('added');
    try {
      tg.checkHomeScreenStatus((s) => setStatus(s));
      tg.onEvent('homeScreenAdded', onAdded);
    } catch {
      // An older client without the call: the button simply stays.
    }
    return () => tg.offEvent?.('homeScreenAdded', onAdded);
  }, []);
  const add = () => {
    try {
      webApp()?.addToHomeScreen();
    } catch {
      setStatus('unsupported');
    }
  };
  return { status, add };
}
