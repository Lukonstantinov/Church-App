import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { InlineKeyboard, type Api } from 'grammy';
import { displayName, messages, type Locale, type Permission } from '@church/shared';
import type { Db } from '../db/client';
import {
  botCards,
  groups,
  memberships,
  positions,
  users,
  type Group,
  type Membership,
  type User,
} from '../db/schema';
import { audit } from './audit';
import { churchDefaultLocale, localeOf } from './church';
import { escapeHtml } from './html';
import { defaultPositionId, effectivePermissions } from './positions';
import { isUnreachableError } from './telegram';

const nowIso = () => new Date().toISOString();

export type JoinResult =
  | { kind: 'invalid' }
  | { kind: 'already_member' | 'already_pending'; group: Group }
  | { kind: 'requested'; group: Group; membership: Membership };

/** Handles a join request from an invite code. New or re-applying members become `pending`. */
export async function requestJoin(db: Db, user: User, inviteCode: string): Promise<JoinResult> {
  const group = await db.query.groups.findFirst({ where: eq(groups.inviteCode, inviteCode) });
  if (!group || group.archivedAt) return { kind: 'invalid' };

  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, user.id), eq(memberships.groupId, group.id)),
  });
  if (existing?.status === 'active') return { kind: 'already_member', group };
  if (existing?.status === 'pending') return { kind: 'already_pending', group };

  let membership: Membership | undefined;
  if (existing) {
    [membership] = await db
      .update(memberships)
      .set({
        status: 'pending',
        role: 'member',
        leftAt: null,
        createdAt: nowIso(),
        positionId: await defaultPositionId(db, group.id),
      })
      .where(eq(memberships.id, existing.id))
      .returning();
  } else {
    [membership] = await db
      .insert(memberships)
      .values({
        userId: user.id,
        groupId: group.id,
        status: 'pending',
        role: 'member',
        positionId: await defaultPositionId(db, group.id),
      })
      .returning();
  }
  if (!membership) throw new Error('membership write failed');
  await audit(db, {
    actorUserId: user.id,
    action: 'join_requested',
    entity: 'membership',
    entityId: membership.id,
    groupId: group.id,
  });
  return { kind: 'requested', group, membership };
}

export interface Recipient {
  userId: number;
  chatId: number;
  locale: Locale;
}

/**
 * Telegram chats to notify for an environment: reachable members whose position has
 * the given right (managing people by default; with a list, any of them), else the
 * church admins.
 */
export async function leaderRecipients(
  db: Db,
  groupId: number,
  perm: Permission | Permission[] = 'people.manage',
): Promise<Recipient[]> {
  const wanted = Array.isArray(perm) ? perm : [perm];
  const fallback = await churchDefaultLocale(db);
  const candidates = await db
    .select({
      userId: users.id,
      chatId: users.telegramId,
      locale: users.locale,
      role: memberships.role,
      permissions: positions.permissions,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.status, 'active'),
        isNotNull(users.telegramId),
        eq(users.isReachable, true),
      ),
    );
  const leaders = candidates.filter((c) =>
    effectivePermissions(false, c).some((p) => wanted.includes(p)),
  );
  const rows = leaders.length
    ? leaders
    : await db
        .select({ userId: users.id, chatId: users.telegramId, locale: users.locale })
        .from(users)
        .where(
          and(eq(users.isAdmin, true), isNotNull(users.telegramId), eq(users.isReachable, true)),
        );
  return rows.flatMap((r) =>
    r.chatId === null
      ? []
      : [{ userId: r.userId, chatId: r.chatId, locale: localeOf(r, fallback) }],
  );
}

export async function markUnreachable(db: Db, userId: number) {
  await db.update(users).set({ isReachable: false }).where(eq(users.id, userId));
}

/** Sends an approve/reject card to every recipient and remembers the messages. */
export async function notifyJoinRequest(api: Api, db: Db, membershipId: number): Promise<number> {
  const row = await db
    .select({ membership: memberships, group: groups, user: users })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, membershipId))
    .get();
  if (!row || row.membership.status !== 'pending') return 0;

  const nameHtml = escapeHtml(displayName(row.user));
  const usernameHtml = row.user.username ? escapeHtml(row.user.username) : null;
  const groupHtml = escapeHtml(row.group.name);

  let sent = 0;
  for (const r of await leaderRecipients(db, row.group.id)) {
    const t = messages(r.locale);
    const keyboard = new InlineKeyboard()
      .text(t.bot.approve, `jr:a:${membershipId}`)
      .text(t.bot.reject, `jr:r:${membershipId}`);
    try {
      const msg = await api.sendMessage(
        r.chatId,
        t.bot.joinCard(nameHtml, usernameHtml, groupHtml),
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        },
      );
      await db.insert(botCards).values({
        kind: 'join_request',
        refId: membershipId,
        chatId: r.chatId,
        messageId: msg.message_id,
      });
      sent++;
    } catch (err) {
      if (isUnreachableError(err)) await markUnreachable(db, r.userId);
      else console.error('join card send failed', err);
    }
  }
  return sent;
}

export type DecisionResult =
  | { kind: 'not_found' | 'already_decided' }
  | { kind: 'ok'; membership: Membership; group: Group; member: User };

/** Approves or rejects a pending membership. Permission checks are the caller's job. */
export async function decideJoin(
  db: Db,
  actor: User,
  membershipId: number,
  approve: boolean,
): Promise<DecisionResult> {
  const current = await db.query.memberships.findFirst({ where: eq(memberships.id, membershipId) });
  if (!current) return { kind: 'not_found' };
  if (current.status !== 'pending') return { kind: 'already_decided' };

  const [membership] = await db
    .update(memberships)
    .set(approve ? { status: 'active', joinedAt: nowIso() } : { status: 'rejected' })
    .where(and(eq(memberships.id, membershipId), eq(memberships.status, 'pending')))
    .returning();
  if (!membership) return { kind: 'already_decided' }; // lost a race with another leader

  await audit(db, {
    actorUserId: actor.id,
    action: approve ? 'join_approved' : 'join_rejected',
    entity: 'membership',
    entityId: membershipId,
    groupId: membership.groupId,
  });
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, membership.groupId) }))!;
  const member = (await db.query.users.findFirst({ where: eq(users.id, membership.userId) }))!;
  return { kind: 'ok', membership, group, member };
}

/**
 * After a decision: updates every leader's card (removing the buttons) and tells
 * the member. Telegram failures are logged, never thrown.
 */
export async function announceJoinDecision(
  api: Api,
  db: Db,
  decision: Extract<DecisionResult, { kind: 'ok' }>,
  actor: User,
  appUrl: string,
) {
  const { membership, group, member } = decision;
  const approved = membership.status === 'active';
  const nameHtml = escapeHtml(displayName(member));
  const groupHtml = escapeHtml(group.name);
  const byHtml = escapeHtml(displayName(actor));
  const fallback = await churchDefaultLocale(db);
  const cardText = (locale: Locale) =>
    approved
      ? messages(locale).bot.joinCardApproved(nameHtml, groupHtml, byHtml)
      : messages(locale).bot.joinCardRejected(nameHtml, groupHtml, byHtml);

  const cards = await db
    .select()
    .from(botCards)
    .where(and(eq(botCards.kind, 'join_request'), eq(botCards.refId, membership.id)));
  const owners = cards.length
    ? await db
        .select({ chatId: users.telegramId, locale: users.locale })
        .from(users)
        .where(
          inArray(
            users.telegramId,
            cards.map((c) => c.chatId),
          ),
        )
    : [];
  const localeByChat = new Map(owners.map((o) => [o.chatId, localeOf(o, fallback)]));
  await Promise.all(
    cards.map((card) =>
      api
        .editMessageText(
          card.chatId,
          card.messageId,
          cardText(localeByChat.get(card.chatId) ?? fallback),
          {
            parse_mode: 'HTML',
          },
        )
        .catch((err) => console.warn('card edit failed', err)),
    ),
  );
  await db
    .delete(botCards)
    .where(and(eq(botCards.kind, 'join_request'), eq(botCards.refId, membership.id)));

  if (member.telegramId && member.isReachable) {
    const t = messages(localeOf(member, fallback));
    try {
      await api.sendMessage(
        member.telegramId,
        approved ? t.bot.joinApprovedToMember(group.name) : t.bot.joinRejectedToMember(group.name),
        approved ? { reply_markup: new InlineKeyboard().webApp(t.bot.openApp, appUrl) } : {},
      );
    } catch (err) {
      if (isUnreachableError(err)) await markUnreachable(db, member.id);
      else console.error('member notify failed', err);
    }
  }
}
