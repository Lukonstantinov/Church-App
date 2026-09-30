import { and, eq } from 'drizzle-orm';
import type { Api } from 'grammy';
import { messages } from '@church/shared';
import type { Db } from '../db/client';
import { groups, memberships, users, type Group, type User } from '../db/schema';
import { can } from './access';
import { churchDefaultLocale, localeOf } from './church';
import { DEEP_LINK, randomCode } from './codes';
import { enqueue } from './outbox';

/**
 * Members-only Telegram chats. Bots can't create groups, so a leader creates one and
 * adds the bot through a "startgroup" link. The bot then issues an invite link that
 * needs approval, approves only active members of the ministry, and removes people
 * who leave the ministry.
 */

/** Rights the bot asks for when added (Telegram pre-ticks them in the add dialog). */
const ADMIN_RIGHTS = 'invite_users+restrict_members';

export async function startChatLink(db: Db, group: Group, botUsername: string) {
  const code = group.chatLinkCode ?? randomCode(12);
  if (!group.chatLinkCode) {
    await db.update(groups).set({ chatLinkCode: code }).where(eq(groups.id, group.id));
  }
  return `https://t.me/${botUsername}?startgroup=${DEEP_LINK.chat}${code}&admin=${ADMIN_RIGHTS}`;
}

export type LinkResult = 'linked' | 'need_admin' | 'invalid' | 'forbidden';

/** Creates the approval-only invite link; fails while the bot isn't an admin yet. */
async function issueInvite(api: Api, db: Db, group: Group, chatId: number, title: string) {
  try {
    const invite = await api.createChatInviteLink(chatId, {
      name: group.name.slice(0, 32),
      creates_join_request: true,
    });
    await db
      .update(groups)
      .set({
        tgChatId: chatId,
        tgChatTitle: title,
        chatUrl: invite.invite_link,
        chatLinkCode: null,
      })
      .where(eq(groups.id, group.id));
    return true;
  } catch (err) {
    console.warn('createChatInviteLink failed', err);
    return false;
  }
}

/** "/start l_<code>" arrived in a group chat after someone added the bot. */
export async function completeChatLink(
  api: Api,
  db: Db,
  args: { code: string; chatId: number; chatTitle: string; by: User },
): Promise<{ result: LinkResult; group?: Group }> {
  const group = await db.query.groups.findFirst({ where: eq(groups.chatLinkCode, args.code) });
  if (!group) return { result: 'invalid' };
  if (!(await can(db, args.by, group.id, 'settings'))) return { result: 'forbidden', group };
  // Remember the chat now, so becoming admin later finishes the link on its own.
  await db
    .update(groups)
    .set({ tgChatId: args.chatId, tgChatTitle: args.chatTitle })
    .where(eq(groups.id, group.id));
  const ok = await issueInvite(api, db, group, args.chatId, args.chatTitle);
  return { result: ok ? 'linked' : 'need_admin', group };
}

/** The bot was promoted in a chat that is waiting to be linked: finish the link. */
export async function retryPendingLink(api: Api, db: Db, chatId: number, chatTitle: string) {
  const group = await db.query.groups.findFirst({ where: eq(groups.tgChatId, chatId) });
  if (!group || !group.chatLinkCode) return null;
  return (await issueInvite(api, db, group, chatId, chatTitle)) ? group : null;
}

/** Approves active members of the chat's ministry; declines (and tells) everyone else. */
export async function handleJoinRequest(
  api: Api,
  db: Db,
  args: { chatId: number; telegramId: number; userChatId?: number },
): Promise<'approved' | 'declined' | 'unknown_chat'> {
  const group = await db.query.groups.findFirst({ where: eq(groups.tgChatId, args.chatId) });
  if (!group) return 'unknown_chat';
  const row = group.archivedAt
    ? undefined
    : await db
        .select({ userId: users.id, locale: users.locale })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .where(
          and(
            eq(users.telegramId, args.telegramId),
            eq(memberships.groupId, group.id),
            eq(memberships.status, 'active'),
          ),
        )
        .get();
  if (row) {
    await api.approveChatJoinRequest(args.chatId, args.telegramId);
    return 'approved';
  }
  await api.declineChatJoinRequest(args.chatId, args.telegramId);
  // Telegram lets a bot message someone who just asked to join, for a few minutes.
  const person = await db.query.users.findFirst({ where: eq(users.telegramId, args.telegramId) });
  const t = messages(localeOf(person ?? null, await churchDefaultLocale(db)));
  await api
    .sendMessage(args.userChatId ?? args.telegramId, t.bot.chatJoinDenied(group.name))
    .catch(() => undefined);
  return 'declined';
}

/** Removes someone from the ministry's chat (kick without a lasting ban). */
export async function removeFromChat(db: Db, groupId: number, userId: number) {
  const group = await db.query.groups.findFirst({
    columns: { tgChatId: true },
    where: eq(groups.id, groupId),
  });
  const user = await db.query.users.findFirst({
    columns: { telegramId: true },
    where: eq(users.id, userId),
  });
  if (!group?.tgChatId || !user?.telegramId) return;
  const chat_id = group.tgChatId;
  const user_id = user.telegramId;
  await enqueue(db, {
    chatId: chat_id,
    method: 'banChatMember',
    payload: { chat_id, user_id, until_date: Math.floor(Date.now() / 1000) + 60 },
    dedupeKey: `kick:${chat_id}:${user_id}:${Date.now()}`,
  });
  await enqueue(db, {
    chatId: chat_id,
    method: 'unbanChatMember',
    payload: { chat_id, user_id, only_if_banned: true },
    dedupeKey: `unkick:${chat_id}:${user_id}:${Date.now()}`,
  });
}

/** Stops managing the chat: the invite link is revoked and the bot leaves. */
export async function unlinkChat(api: Api, db: Db, group: Group) {
  if (group.tgChatId) {
    if (group.chatUrl)
      await api.revokeChatInviteLink(group.tgChatId, group.chatUrl).catch(() => undefined);
    await api.leaveChat(group.tgChatId).catch(() => undefined);
  }
  await db
    .update(groups)
    .set({
      tgChatId: null,
      tgChatTitle: null,
      chatLinkCode: null,
      chatUrl: group.tgChatId ? null : group.chatUrl,
    })
    .where(eq(groups.id, group.id));
}
