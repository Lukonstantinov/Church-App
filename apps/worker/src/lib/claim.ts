import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { auditLog, botCards, groups, memberships, users, type User } from '../db/schema';
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

export type MergeResult =
  | { kind: 'not_found' | 'invalid' | 'account_in_use' | 'already_decided' }
  | {
      kind: 'ok';
      membership: typeof memberships.$inferSelect;
      group: typeof groups.$inferSelect;
      member: User;
    };

/**
 * An admin's way to make a made-up (offline) person real: a join request from a real
 * Telegram account is merged into an offline person of the same ministry instead of
 * being approved as someone new. The offline profile keeps its id, so everything on it
 * (attendance, positions, labels, birthday, notes) stays; it gets the Telegram account,
 * and the request's own bare account is removed. The result looks like an approval, so
 * the cards and the message to the person can be sent as usual.
 */
export async function mergeJoinIntoOffline(
  db: Db,
  actor: User,
  requestMembershipId: number,
  offlineUserId: number,
): Promise<MergeResult> {
  const request = await db.query.memberships.findFirst({
    where: eq(memberships.id, requestMembershipId),
  });
  if (!request) return { kind: 'not_found' };
  if (request.status !== 'pending') return { kind: 'already_decided' };
  const real = await db.query.users.findFirst({ where: eq(users.id, request.userId) });
  const offline = await db.query.users.findFirst({ where: eq(users.id, offlineUserId) });
  if (!real?.telegramId || !offline || offline.telegramId !== null || offline.anonymizedAt)
    return { kind: 'invalid' };
  const mine = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, offline.id), eq(memberships.groupId, request.groupId)),
  });
  if (!mine) return { kind: 'invalid' };
  // Only a fresh account (this one request) can be folded in without losing anything.
  const others = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, real.id));
  if (others.length !== 1) return { kind: 'account_in_use' };

  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .update(botCards)
        .set({ refId: mine.id })
        .where(and(eq(botCards.kind, 'join_request'), eq(botCards.refId, request.id))),
      db.delete(memberships).where(eq(memberships.id, request.id)),
      db
        .update(memberships)
        .set({ status: 'active', joinedAt: mine.joinedAt ?? now, leftAt: null })
        .where(eq(memberships.id, mine.id)),
      db.update(auditLog).set({ actorUserId: offline.id }).where(eq(auditLog.actorUserId, real.id)),
      db.delete(users).where(eq(users.id, real.id)),
      db
        .update(users)
        .set({
          telegramId: real.telegramId,
          username: real.username,
          languageCode: real.languageCode,
          isAdmin: sql`${users.isAdmin} OR ${real.isAdmin ? 1 : 0}`,
          isReachable: true,
          privacyAcceptedAt: real.privacyAcceptedAt,
          privacyVersion: real.privacyVersion,
          photoMediaId: offline.photoMediaId ?? real.photoMediaId,
          claimCode: null,
          claimExpiresAt: null,
        })
        .where(eq(users.id, offline.id)),
      db.insert(auditLog).values({
        actorUserId: actor.id,
        action: 'profile_merged',
        entity: 'user',
        entityId: offline.id,
        groupId: request.groupId,
        data: { telegramId: real.telegramId },
      }),
    ]);
  } catch {
    // The account turned out to be tied to something else (a row that points at it).
    return { kind: 'account_in_use' };
  }
  const membership = (await db.query.memberships.findFirst({
    where: eq(memberships.id, mine.id),
  }))!;
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, request.groupId) }))!;
  const member = (await db.query.users.findFirst({ where: eq(users.id, offline.id) }))!;
  return { kind: 'ok', membership, group, member };
}
