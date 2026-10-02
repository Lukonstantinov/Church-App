import { and, eq } from 'drizzle-orm';
import type { Api } from 'grammy';
import { messages } from '@church/shared';
import type { Db } from '../db/client';
import { eventRoleAssignees, eventRoles, eventRsvps, events, users, type User } from '../db/schema';
import { accessIn } from './access';
import { churchDefaultLocale, localeOf } from './church';
import { DEEP_LINK, randomCode } from './codes';

type EventRow = typeof events.$inferSelect;

/**
 * An event's own Telegram chat. Bots can't create groups, so a leader creates one and
 * adds the bot through a "startgroup" link; the bot then issues an approval-only invite
 * and lets in only people who serve at the event, are going to it, or manage events.
 */
const ADMIN_RIGHTS = 'invite_users+restrict_members';

export async function startEventChatLink(db: Db, event: EventRow, botUsername: string) {
  const code = event.chatLinkCode ?? randomCode(12);
  if (!event.chatLinkCode) {
    await db.update(events).set({ chatLinkCode: code }).where(eq(events.id, event.id));
  }
  return `https://t.me/${botUsername}?startgroup=${DEEP_LINK.eventChat}${code}&admin=${ADMIN_RIGHTS}`;
}

export type EventLinkResult = 'linked' | 'need_admin' | 'invalid' | 'forbidden';

async function issueInvite(api: Api, db: Db, event: EventRow, chatId: number, title: string) {
  try {
    const invite = await api.createChatInviteLink(chatId, {
      name: event.title.slice(0, 32),
      creates_join_request: true,
    });
    await db
      .update(events)
      .set({
        tgChatId: chatId,
        tgChatTitle: title,
        chatUrl: invite.invite_link,
        chatLinkCode: null,
      })
      .where(eq(events.id, event.id));
    return true;
  } catch (err) {
    console.warn('createChatInviteLink (event) failed', err);
    return false;
  }
}

/** "/start e_<code>" arrived in a group chat after someone added the bot. */
export async function completeEventChatLink(
  api: Api,
  db: Db,
  args: { code: string; chatId: number; chatTitle: string; by: User },
): Promise<{ result: EventLinkResult; event?: EventRow }> {
  const event = await db.query.events.findFirst({ where: eq(events.chatLinkCode, args.code) });
  if (!event) return { result: 'invalid' };
  const access = await accessIn(db, args.by, event.groupId);
  if (!access.member || !access.perms.has('events.manage')) return { result: 'forbidden', event };
  await db
    .update(events)
    .set({ tgChatId: args.chatId, tgChatTitle: args.chatTitle })
    .where(eq(events.id, event.id));
  const ok = await issueInvite(api, db, event, args.chatId, args.chatTitle);
  return { result: ok ? 'linked' : 'need_admin', event };
}

/** The bot was promoted in a chat that is waiting to be linked to an event. */
export async function retryPendingEventLink(api: Api, db: Db, chatId: number, chatTitle: string) {
  const event = await db.query.events.findFirst({ where: eq(events.tgChatId, chatId) });
  if (!event || !event.chatLinkCode) return null;
  return (await issueInvite(api, db, event, chatId, chatTitle)) ? event : null;
}

/** May this person be in the event's chat? */
async function mayJoin(db: Db, event: EventRow, user: User): Promise<boolean> {
  const access = await accessIn(db, user, event.groupId);
  if (!access.member) return false;
  if (access.perms.has('events.manage')) return true;
  const duty = await db
    .select({ roleId: eventRoleAssignees.roleId })
    .from(eventRoleAssignees)
    .innerJoin(eventRoles, eq(eventRoles.id, eventRoleAssignees.roleId))
    .where(and(eq(eventRoles.eventId, event.id), eq(eventRoleAssignees.userId, user.id)))
    .get();
  if (duty) return true;
  const going = await db
    .select({ userId: eventRsvps.userId })
    .from(eventRsvps)
    .where(
      and(
        eq(eventRsvps.eventId, event.id),
        eq(eventRsvps.userId, user.id),
        eq(eventRsvps.status, 'going'),
      ),
    )
    .get();
  return !!going;
}

/** Approves people who serve / are going / manage the event; declines (and tells) the rest. */
export async function handleEventJoinRequest(
  api: Api,
  db: Db,
  args: { chatId: number; telegramId: number; userChatId?: number },
): Promise<'approved' | 'declined' | 'unknown_chat'> {
  const event = await db.query.events.findFirst({ where: eq(events.tgChatId, args.chatId) });
  if (!event) return 'unknown_chat';
  const user = await db.query.users.findFirst({ where: eq(users.telegramId, args.telegramId) });
  if (user && (await mayJoin(db, event, user))) {
    await api.approveChatJoinRequest(args.chatId, args.telegramId);
    return 'approved';
  }
  await api.declineChatJoinRequest(args.chatId, args.telegramId);
  const t = messages(localeOf(user ?? null, await churchDefaultLocale(db)));
  await api
    .sendMessage(args.userChatId ?? args.telegramId, t.bot.eventChatJoinDenied(event.title))
    .catch(() => undefined);
  return 'declined';
}

/** Stops managing the chat: the invite link is revoked and the bot leaves. */
export async function unlinkEventChat(api: Api, db: Db, event: EventRow) {
  if (event.tgChatId) {
    if (event.chatUrl)
      await api.revokeChatInviteLink(event.tgChatId, event.chatUrl).catch(() => undefined);
    await api.leaveChat(event.tgChatId).catch(() => undefined);
  }
  await db
    .update(events)
    .set({
      tgChatId: null,
      tgChatTitle: null,
      chatLinkCode: null,
      chatUrl: event.tgChatId ? null : event.chatUrl,
    })
    .where(eq(events.id, event.id));
}
