import { and, desc, eq, inArray } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import {
  displayName,
  messages,
  type AnnouncementResult,
  type AnnouncementRow,
} from '@church/shared';
import type { Db } from '../db/client';
import { announcements, groups, memberships, users, type Group, type User } from '../db/schema';
import { audit } from './audit';
import { churchDefaultLocale, localeOf } from './church';
import { escapeHtml } from './html';
import { enqueue } from './outbox';

type AnnouncementDbRow = typeof announcements.$inferSelect;

/**
 * Saves an announcement and queues a bot message to every active member who can
 * receive one (has Telegram, hasn't blocked the bot). The author doesn't get a copy.
 */
export async function createAnnouncement(
  db: Db,
  args: { group: Group; author: User; text: string; appUrl: string | null },
): Promise<AnnouncementResult> {
  const { group, author, text, appUrl } = args;
  const members = await db
    .select({
      id: users.id,
      chatId: users.telegramId,
      reachable: users.isReachable,
      locale: users.locale,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupId, group.id), eq(memberships.status, 'active')));

  const others = members.filter((m) => m.id !== author.id);
  const reachable = others.filter((m) => m.chatId !== null && m.reachable);
  const noTelegram = others.filter((m) => m.chatId === null).length;
  const unreachable = others.filter((m) => m.chatId !== null && !m.reachable).length;

  const [row] = await db
    .insert(announcements)
    .values({ groupId: group.id, authorId: author.id, text, recipients: reachable.length })
    .returning();
  await audit(db, {
    actorUserId: author.id,
    action: 'announcement_sent',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: { announcementId: row!.id, recipients: reachable.length },
  });

  const fallback = await churchDefaultLocale(db);
  const body = `📢 <b>${escapeHtml(group.name)}</b>\n\n${escapeHtml(text)}\n\n— ${escapeHtml(displayName(author))}`;
  for (const m of reachable) {
    const t = messages(localeOf(m, fallback));
    await enqueue(db, {
      chatId: m.chatId!,
      method: 'sendMessage',
      payload: {
        chat_id: m.chatId,
        text: body,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: appUrl ? new InlineKeyboard().webApp(t.bot.openApp, appUrl) : undefined,
      },
      dedupeKey: `ann:${row!.id}:${m.chatId}`,
    });
  }

  return {
    announcement: toRow(row!, group.name, author),
    noTelegram,
    unreachable,
  };
}

function toRow(
  a: AnnouncementDbRow,
  groupName: string,
  author: Pick<User, 'id' | 'firstName' | 'lastName'> | null,
): AnnouncementRow {
  return {
    id: a.id,
    groupId: a.groupId,
    groupName,
    text: a.text,
    createdAt: a.createdAt,
    author: author
      ? { id: author.id, firstName: author.firstName, lastName: author.lastName }
      : null,
    recipients: a.recipients,
  };
}

/** Newest first. */
export async function listAnnouncements(
  db: Db,
  groupIds: number[],
  limit = 30,
): Promise<AnnouncementRow[]> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .select({ a: announcements, groupName: groups.name, author: users })
    .from(announcements)
    .innerJoin(groups, eq(groups.id, announcements.groupId))
    .leftJoin(users, eq(users.id, announcements.authorId))
    .where(inArray(announcements.groupId, groupIds))
    .orderBy(desc(announcements.createdAt), desc(announcements.id))
    .limit(limit);
  return rows.map((r) => toRow(r.a, r.groupName, r.author));
}
