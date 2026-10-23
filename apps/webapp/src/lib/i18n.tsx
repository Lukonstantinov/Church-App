import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  INTL_LOCALE,
  loadMessages,
  messagesNow,
  type Locale,
  type Messages,
} from '@church/shared';

interface I18n {
  locale: Locale;
  /** BCP 47 tag for Intl, e.g. "lt-LT". */
  intl: string;
  t: Messages;
}

const I18nContext = createContext<I18n>({
  locale: DEFAULT_LOCALE,
  intl: INTL_LOCALE[DEFAULT_LOCALE],
  t: messagesNow(DEFAULT_LOCALE),
});

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // Other languages than Russian are fetched on first use: nothing shows until they are here,
  // and a later change of language keeps the old text on screen until the new one has arrived.
  const [shown, setShown] = useState<Locale | null>(locale === DEFAULT_LOCALE ? locale : null);
  useEffect(() => {
    let alive = true;
    void loadMessages(locale).then(() => alive && setShown(locale));
    return () => {
      alive = false;
    };
  }, [locale]);
  const value = useMemo(
    () => (shown ? { locale: shown, intl: INTL_LOCALE[shown], t: messagesNow(shown) } : null),
    [shown],
  );
  // Screen readers and hyphenation follow the chosen language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return value ? <I18nContext.Provider value={value}>{children}</I18nContext.Provider> : null;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;
