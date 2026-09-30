import type { ChurchInfo } from '@church/shared';
import type { Db } from '../db/client';

/** Church-wide settings (single row). Falls back to defaults if the row is missing. */
export async function getChurch(db: Db): Promise<ChurchInfo> {
  const row = await db.query.churchSettings.findFirst();
  return {
    name: row?.name ?? 'Церковь',
    timezone: row?.timezone ?? 'Europe/Riga',
    currency: row?.currency ?? 'EUR',
  };
}

export async function getAppUrl(db: Db, envUrl?: string): Promise<string | null> {
  if (envUrl) return envUrl;
  const row = await db.query.churchSettings.findFirst({ columns: { appUrl: true } });
  return row?.appUrl ?? null;
}
