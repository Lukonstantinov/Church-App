export const LOCALES = ['ru', 'en', 'lt'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

/** Names shown in the language picker, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
  lt: 'Lietuvių',
};

/** BCP 47 tags for Intl formatting. */
export const INTL_LOCALE: Record<Locale, string> = {
  ru: 'ru-RU',
  en: 'en-GB',
  lt: 'lt-LT',
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
