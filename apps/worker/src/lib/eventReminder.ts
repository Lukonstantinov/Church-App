import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { INTL_LOCALE, messages, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import { memberships, users, type Group, type events } from '../db/schema';

type Event = typeof events.$inferSelect;
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { enqueue } from './outbox';

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');

async function whenOf(db: Db, event: Event, locale: Locale) {
  const { timezone } = await getChurch(db);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(event.startsAt));
}

/** The default reminder as plain text (for the sender to read and change). */
export async function defaultReminderText(db: Db, event: Event, locale: Locale): Promise<string> {
  const t = messages(locale);
  const when = await whenOf(db, event, locale);
  return stripTags(t.bot.eventReminder(event.title, when, event.location));
}

/** Active, reachable members of a ministry (optionally only these people). */
async function recipients(db: Db, groupId: number, userIds?: number[] | null) {
  const rows = await db
    .select({ id: users.id, chatId: users.telegramId, locale: users.locale })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.status, 'active'),
        eq(users.isReachable, true),
        isNotNull(users.telegramId),
        ...(userIds && userIds.length > 0 ? [inArray(users.id, userIds)] : []),
      ),
    );
  return rows as { id: number; chatId: number; locale: string | null }[];
}

/**
 * Queues the reminder for the ministry's members (or only chosen ones). With a custom
 * text it goes as written (plus the sender's name); without, each person gets the default
 * in their own language. Returns how many were queued.
 */
export async function sendEventReminder(
  db: Db,
  args: {
    event: Event;
    group: Pick<Group, 'id'>;
    text?: string | null;
    userIds?: number[] | null;
    senderName?: string | null;
    envAppUrl?: string;
    fallbackUrl: string | null;
    /** Stable key part so an automatic reminder can't be queued twice. */
    dedupe?: string;
  },
): Promise<number> {
  const fallback = await churchDefaultLocale(db);
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const list = await recipients(db, args.group.id, args.userIds);
  const stamp = args.dedupe ?? String(Date.now());
  for (const r of list) {
    const locale = localeOf({ locale: r.locale }, fallback);
    const t = messages(locale);
    let html: string;
    if (args.text) {
      const [first, ...rest] = escapeHtml(args.text).split('\n');
      html = [`<b>${first}</b>`, ...rest].join('\n');
    } else {
      const when = await whenOf(db, args.event, locale);
      html = t.bot.eventReminder(
        escapeHtml(args.event.title),
        when,
        args.event.location ? escapeHtml(args.event.location) : null,
      );
    }
    if (args.senderName) html += `\n\n<i>${escapeHtml(t.bot.sentBy(args.senderName))}</i>`;
    const reply_markup = appUrl
      ? new InlineKeyboard().webApp(t.bot.eventButton, `${appUrl}/?event=${args.event.id}`)
      : undefined;
    await enqueue(db, {
      chatId: r.chatId,
      method: 'sendMessage',
      payload: { chat_id: r.chatId, text: html, parse_mode: 'HTML', reply_markup },
      dedupeKey: `evremind:${args.event.id}:${r.chatId}:${stamp}`,
    });
  }
  return list.length;
}
