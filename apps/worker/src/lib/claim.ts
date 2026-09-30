import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { auditLog, memberships, users, type User } from '../db/schema';
import { randomCode } from './codes';

export const CLAIM_TTL_DAYS = 7;

export async function issueClaimCode(
  db: Db,
  userId: number,
): Promise<{ code: string; expiresAt: string }> {
  const code = randomCode(10);
  const expiresAt = new Date(Date.now() + CLAIM_TTL_DAYS * 86_400_000).toISOString();
  await db
    .update(users)
    .set({ claimCode: code, claimExpiresAt: expiresAt })
    .where(eq(users.id, userId));
  return { code, expiresAt };
}

export type ClaimResult = { kind: 'invalid' | 'account_in_use' } | { kind: 'claimed'; user: User };

/**
 * Links the Telegram account behind `telegramUser` to an offline profile.
 * `telegramUser` is the row auto-created when they wrote to the bot; it is merged
 * into the offline profile and removed. Refused if it already has memberships.
 */
export async function claimProfile(db: Db, telegramUser: User, code: string): Promise<ClaimResult> {
  const target = await db.query.users.findFirst({
    where: and(
      eq(users.claimCode, code),
      isNull(users.telegramId),
      gt(users.claimExpiresAt, new Date().toISOString()),
    ),
  });
  if (!target || !telegramUser.telegramId) return { kind: 'invalid' };

  const hasMemberships = await db.query.memberships.findFirst({
    columns: { id: true },
    where: eq(memberships.userId, telegramUser.id),
  });
  if (hasMemberships) return { kind: 'account_in_use' };

  await db.batch([
    db
      .update(auditLog)
      .set({ actorUserId: target.id })
      .where(eq(auditLog.actorUserId, telegramUser.id)),
    db.delete(users).where(eq(users.id, telegramUser.id)),
    db
      .update(users)
      .set({
        telegramId: telegramUser.telegramId,
        username: telegramUser.username,
        languageCode: telegramUser.languageCode,
        isAdmin: sql`${users.isAdmin} OR ${telegramUser.isAdmin ? 1 : 0}`,
        isReachable: true,
        privacyAcceptedAt: telegramUser.privacyAcceptedAt,
        privacyVersion: telegramUser.privacyVersion,
        claimCode: null,
        claimExpiresAt: null,
      })
      .where(eq(users.id, target.id)),
    db.insert(auditLog).values({
      actorUserId: target.id,
      action: 'profile_claimed',
      entity: 'user',
      entityId: target.id,
      data: { telegramId: telegramUser.telegramId },
    }),
  ]);
  const user = (await db.query.users.findFirst({ where: eq(users.id, target.id) }))!;
  return { kind: 'claimed', user };
}
