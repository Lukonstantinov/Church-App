import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, INTL_LOCALE, messages, type Locale, type Messages } from '@church/shared';

interface I18n {
  locale: Locale;
  /** BCP 47 tag for Intl, e.g. "lt-LT". */
  intl: string;
  t: Messages;
}

const I18nContext = createContext<I18n>({
  locale: DEFAULT_LOCALE,
  intl: INTL_LOCALE[DEFAULT_LOCALE],
  t: messages(DEFAULT_LOCALE),
});

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(
    () => ({ locale, intl: INTL_LOCALE[locale], t: messages(locale) }),
    [locale],
  );
  // Screen readers and hyphenation follow the chosen language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;
