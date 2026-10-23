import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';
import { ru, type Messages } from './ru';

/**
 * For the app: Russian is built in, the other languages are fetched when first needed, so a
 * phone only downloads its own. (The worker uses `messages` from ./index, which has all.)
 */
const loaded: Partial<Record<Locale, Messages>> = { ru };

export async function loadMessages(locale: Locale): Promise<Messages> {
  if (!loaded[locale]) {
    loaded[locale] = locale === 'en' ? (await import('./en')).en : (await import('./lt')).lt;
  }
  return loaded[locale]!;
}

/** The messages of a language already loaded (Russian until it is). */
export function messagesNow(locale: string | null | undefined): Messages {
  return loaded[isLocale(locale) ? locale : DEFAULT_LOCALE] ?? ru;
}
