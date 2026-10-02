import { and, eq, inArray } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { INTL_LOCALE, displayName, messages, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import { memberships, users, type Meeting } from '../db/schema';
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { audienceOf } from './meetings';
import { recordNotification } from './notifications';
import { enqueue } from './outbox';

/**
 * The default announcement of a meeting, as plain text the sender can change: title,
 * topic, when, where, who leads, and the notes.
 */
export async function defaultMeetingAnnouncement(
  db: Db,
  meeting: Meeting,
  locale: Locale,
): Promise<string> {
  const t = messages(locale).bot;
  const { timezone } = await getChurch(db);
  const intl = INTL_LOCALE[locale];
  const day = new Intl.DateTimeFormat(intl, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(meeting.startsAt));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(intl, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  const leader = meeting.leaderUserId
    ? await db.query.users.findFirst({ where: eq(users.id, meeting.leaderUserId) })
    : null;
  return [
    `📣 ${meeting.title}`,
    meeting.topic ? `«${meeting.topic}»` : null,
    '',
    `🗓 ${day}, ${time(meeting.startsAt)}–${time(meeting.endsAt)}`,
    meeting.location ? `📍 ${meeting.location}` : null,
    leader ? `🎤 ${t.whoLeads}: ${displayName(leader)}` : null,
    meeting.notes ? `\n${meeting.notes.trim()}` : null,
  ]
    .filter((x) => x !== null)
    .join('\n')
    .trim();
}

/**
 * Sends a meeting announcement to everyone it is for (or chosen people): the poster as a
 * picture with the text as its caption, the sender's name, and a button to the meeting.
 * Everyone gets it in the app's notifications; the bot message goes to those it can reach.
 */
export async function announceMeeting(
  db: Db,
  args: {
    meeting: Meeting;
    text?: string | null;
    userIds?: number[] | null;
    posterMediaId?: number | null;
    senderName: string;
    envAppUrl?: string;
    fallbackUrl: string | null;
  },
): Promise<{ total: number; bot: number }> {
  const { meeting } = args;
  const fallback = await churchDefaultLocale(db);
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const audience = (await audienceOf(db, [meeting.id])).get(meeting.id) ?? null;
  // Chosen people, else everyone the meeting is for.
  const only = args.userIds?.length ? args.userIds : audience;
  const people = await db
    .select({
      id: users.id,
      chatId: users.telegramId,
      reachable: users.isReachable,
      locale: users.locale,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.groupId, meeting.groupId),
        eq(memberships.status, 'active'),
        ...(only ? [inArray(users.id, only.length ? only : [-1])] : []),
      ),
    );
  const stamp = Date.now();
  let bot = 0;
  for (const p of people) {
    const locale = localeOf({ locale: p.locale }, fallback);
    const t = messages(locale).bot;
    const text = args.text ?? (await defaultMeetingAnnouncement(db, meeting, locale));
    const [first, ...rest] = escapeHtml(text).split('\n');
    const html = `${[`<b>${first}</b>`, ...rest].join('\n')}\n\n<i>${escapeHtml(t.sentBy(args.senderName))}</i>`;
    await recordNotification(db, {
      userId: p.id,
      kind: 'meeting_announce',
      title: t.notifMeetingTitle(meeting.title),
      body: `${text}\n${t.sentBy(args.senderName)}`,
      link: { type: 'task', meetingId: meeting.id },
    });
    if (!p.chatId || !p.reachable) continue;
    const reply_markup = appUrl
      ? new InlineKeyboard().webApp(t.meetingButton, `${appUrl}/?meeting=${meeting.id}`)
      : undefined;
    const asPhoto = args.posterMediaId && html.length <= 1024;
    await enqueue(db, {
      chatId: p.chatId,
      method: asPhoto ? 'sendPhoto' : 'sendMessage',
      payload: asPhoto
        ? {
            chat_id: p.chatId,
            photo_media_id: args.posterMediaId,
            caption: html,
            parse_mode: 'HTML',
            reply_markup,
          }
        : {
            chat_id: p.chatId,
            text: html,
            parse_mode: 'HTML',
            reply_markup,
            link_preview_options: { is_disabled: true },
          },
      dedupeKey: `mtgannounce:${meeting.id}:${p.chatId}:${stamp}`,
    });
    bot++;
  }
  return { total: people.length, bot };
}
