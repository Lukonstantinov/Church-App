import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { memberships, groups, users, type User } from '../db/schema';
import type { MeResponse } from '@church/shared';
import { getChurch } from './church';

export interface TelegramProfile {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Creates the user on first contact and grants church admin to ids listed in
 * ADMIN_TELEGRAM_IDS. Names are taken from Telegram only once: afterwards leaders
 * may correct them (real names instead of nicknames), so only the username and
 * language are refreshed.
 */
export async function upsertTelegramUser(
  db: Db,
  profile: TelegramProfile,
  adminIds: Set<number>,
): Promise<User> {
  const values = {
    telegramId: profile.id,
    firstName: profile.first_name.slice(0, 64),
    lastName: profile.last_name?.slice(0, 64) ?? null,
    username: profile.username ?? null,
    languageCode: profile.language_code ?? null,
  };
  const isBootstrapAdmin = adminIds.has(profile.id);
  const refresh = {
    username: values.username,
    languageCode: values.languageCode,
    isReachable: true,
    ...(isBootstrapAdmin ? { isAdmin: true } : {}),
  };

  // Read first: most requests come from known users with unchanged profiles, and
  // skipping the write keeps us well inside D1's free daily write quota.
  const existing = await db.query.users.findFirst({ where: eq(users.telegramId, profile.id) });
  if (existing) {
    const changed = (Object.keys(refresh) as (keyof typeof refresh)[]).some(
      (k) => existing[k] !== refresh[k],
    );
    if (!changed) return existing;
    const [updated] = await db
      .update(users)
      .set(refresh)
      .where(eq(users.id, existing.id))
      .returning();
    return updated!;
  }

  const [row] = await db
    .insert(users)
    .values({ ...values, isAdmin: isBootstrapAdmin })
    .onConflictDoUpdate({ target: users.telegramId, set: refresh }) // concurrent first requests
    .returning();
  if (!row) throw new Error('upsert returned no row');
  return row;
}

export async function loadMe(db: Db, user: User): Promise<MeResponse> {
  const rows = await db
    .select({
      groupId: groups.id,
      groupName: groups.name,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.userId, user.id), isNull(groups.archivedAt)))
    .orderBy(groups.name);

  return {
    church: await getChurch(db),
    user: {
      id: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      isAdmin: user.isAdmin,
      privacyAccepted: user.privacyAcceptedAt !== null,
    },
    memberships: rows.filter((r) => r.status === 'active' || r.status === 'pending'),
  };
}

export async function acceptPrivacy(db: Db, userId: number): Promise<void> {
  const settings = await db.query.churchSettings.findFirst();
  await db
    .update(users)
    .set({
      privacyAcceptedAt: new Date().toISOString(),
      privacyVersion: settings?.privacyVersion ?? 1,
    })
    .where(eq(users.id, userId));
}
