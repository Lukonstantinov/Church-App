import {
  DEFAULT_BRAND,
  isBrandValue,
  DEFAULT_LOCALE,
  isLocale,
  type ChurchInfo,
  type Locale,
} from '@church/shared';
import type { Db } from '../db/client';
import type { User } from '../db/schema';

/** Church-wide settings (single row). Falls back to defaults if the row is missing. */
export async function getChurch(db: Db): Promise<ChurchInfo> {
  const row = await db.query.churchSettings.findFirst({
    columns: {
      name: true,
      timezone: true,
      currency: true,
      defaultLocale: true,
      brandColor: true,
      logoUpdatedAt: true,
      sheetLabel: true,
      appBackground: true,
      designLock: true,
    },
  });
  const brand = row?.brandColor ?? DEFAULT_BRAND;
  return {
    name: row?.name ?? 'Церковь',
    timezone: row?.timezone ?? 'Europe/Riga',
    currency: row?.currency ?? 'EUR',
    defaultLocale: isLocale(row?.defaultLocale) ? row.defaultLocale : DEFAULT_LOCALE,
    brandColor: isBrandValue(brand) ? brand : DEFAULT_BRAND,
    logoUrl: row?.logoUpdatedAt ? `/media/logo?v=${encodeURIComponent(row.logoUpdatedAt)}` : null,
    sheetLabel: row?.sheetLabel || null,
    appBackground: row?.appBackground ?? null,
    designLock: row?.designLock ?? false,
  };
}

export async function getAppUrl(db: Db, envUrl?: string): Promise<string | null> {
  if (envUrl) return envUrl;
  const row = await db.query.churchSettings.findFirst({ columns: { appUrl: true } });
  return row?.appUrl ?? null;
}

/** A person's UI language: their own choice, else the church default. */
export function localeOf(user: Pick<User, 'locale'> | null | undefined, fallback: Locale): Locale {
  return isLocale(user?.locale) ? user.locale : fallback;
}

export async function churchDefaultLocale(db: Db): Promise<Locale> {
  const row = await db.query.churchSettings.findFirst({ columns: { defaultLocale: true } });
  return isLocale(row?.defaultLocale) ? row.defaultLocale : DEFAULT_LOCALE;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
