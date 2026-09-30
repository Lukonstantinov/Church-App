import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { memberships, groups, users, type User } from '../db/schema';
import type { MeResponse } from '@church/shared';

export interface TelegramProfile {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Creates the user on first contact, keeps name/username fresh afterwards,
 * and grants church admin to ids listed in ADMIN_TELEGRAM_IDS.
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
  const [row] = await db
    .insert(users)
    .values({ ...values, isAdmin: isBootstrapAdmin })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: isBootstrapAdmin ? { ...values, isAdmin: true } : values,
    })
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
    .where(eq(memberships.userId, user.id))
    .orderBy(groups.name);

  return {
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
