import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { INTL_LOCALE, messages, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import { users, type Meeting } from '../db/schema';
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { enqueue } from './outbox';

/**
 * Bot messages about a meeting: to the person who will lead it, and to the person who
 * buys food (with the amount they may spend). Both get a button that opens the meeting.
 */
export async function notifyMeetingRole(
  db: Db,
  args: {
    meeting: Meeting;
    groupName: string;
    userId: number;
    role: 'leader' | 'snack';
    budgetCents: number;
    envAppUrl?: string;
    fallbackUrl: string | null;
    /** The meeting notes, added under the message. */
    notes?: string | null;
  },
) {
  const person = await db.query.users.findFirst({ where: eq(users.id, args.userId) });
  if (!person?.telegramId || !person.isReachable) return false;
  const { timezone, currency } = await getChurch(db);
  const locale: Locale = localeOf(person, await churchDefaultLocale(db));
  const t = messages(locale);
  const intl = INTL_LOCALE[locale];
  const date = new Intl.DateTimeFormat(intl, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(args.meeting.startsAt));
  const budget = new Intl.NumberFormat(intl, { style: 'currency', currency }).format(
    args.budgetCents / 100,
  );
  const title = escapeHtml(args.meeting.title);
  const group = escapeHtml(args.groupName);
  const base =
    args.role === 'leader'
      ? t.bot.meetingLeader(title, group, escapeHtml(date), escapeHtml(budget))
      : t.bot.meetingSnack(title, group, escapeHtml(date), escapeHtml(budget));
  const text = args.notes ? `${base}\n\n📝 ${escapeHtml(args.notes)}` : base;
  const appUrl = (await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl;
  const reply_markup = appUrl
    ? new InlineKeyboard().webApp(t.bot.meetingButton, `${appUrl}/?meeting=${args.meeting.id}`)
    : undefined;
  await enqueue(db, {
    chatId: person.telegramId,
    method: 'sendMessage',
    payload: { chat_id: person.telegramId, text, parse_mode: 'HTML', reply_markup },
    dedupeKey: `meeting:${args.role}:${args.meeting.id}:${person.telegramId}:${Date.now()}`,
  });
  return true;
}
