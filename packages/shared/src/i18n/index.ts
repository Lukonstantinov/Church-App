import { en } from './en';
import { lt } from './lt';
import { ru, type Messages } from './ru';
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';

export const MESSAGES: Record<Locale, Messages> = { ru, en, lt };

export function messages(locale: string | null | undefined): Messages {
  return MESSAGES[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

export type { Messages };
