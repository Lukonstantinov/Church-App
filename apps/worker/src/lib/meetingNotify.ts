import { eq } from 'drizzle-orm';
import { InlineKeyboard, type Api } from 'grammy';
import { INTL_LOCALE, displayName, messages, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import { meetings, users, type Meeting, type User } from '../db/schema';
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { enqueue } from './outbox';

type Role = 'leader' | 'snack';

/** Date of a meeting and an amount, in the recipient's language and the church zone. */
async function wording(db: Db, meeting: Meeting, locale: Locale, budgetCents: number) {
  const { timezone, currency } = await getChurch(db);
  const intl = INTL_LOCALE[locale];
  const date = new Intl.DateTimeFormat(intl, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(meeting.startsAt));
  const budget = new Intl.NumberFormat(intl, { style: 'currency', currency }).format(
    budgetCents / 100,
  );
  return { date, budget };
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');

/**
 * The default message for the leader or snack person, as plain text the sender can
 * edit before sending. The meeting notes go at the end.
 */
export async function defaultMeetingText(
  db: Db,
  args: {
    meeting: Meeting;
    groupName: string;
    userId: number;
    role: Role;
    budgetCents: number;
    notes?: string | null;
  },
): Promise<string> {
  const person = await db.query.users.findFirst({ where: eq(users.id, args.userId) });
  const locale = localeOf(person ?? null, await churchDefaultLocale(db));
  const t = messages(locale);
  const { date, budget } = await wording(db, args.meeting, locale, args.budgetCents);
  const base =
    args.role === 'leader'
      ? t.bot.meetingLeader(args.meeting.title, args.groupName, date, budget)
      : t.bot.meetingSnack(args.meeting.title, args.groupName, date, budget);
  const text = stripTags(base);
  return args.notes ? `${text}\n\n📝 ${args.notes}` : text;
}

/**
 * Sends the (possibly edited) message with "Agree" / "Can't" buttons and a button that
 * opens the meeting; the poster (if any) comes just before it.
 */
export async function notifyMeetingRole(
  db: Db,
  args: {
    meeting: Meeting;
    userId: number;
    role: Role;
    text: string;
    posterUrl?: string | null;
    envAppUrl?: string;
    fallbackUrl: string | null;
  },
) {
  const person = await db.query.users.findFirst({ where: eq(users.id, args.userId) });
  if (!person?.telegramId || !person.isReachable) return false;
  const locale: Locale = localeOf(person, await churchDefaultLocale(db));
  const t = messages(locale);
  // The first line is the headline.
  const [first, ...rest] = escapeHtml(args.text).split('\n');
  const html = [`<b>${first}</b>`, ...rest].join('\n');
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const code = `${args.meeting.id}:${args.role === 'leader' ? 'l' : 's'}`;
  const keyboard = new InlineKeyboard()
    .text(t.bot.meetingAgree, `ma:y:${code}`)
    .text(t.bot.meetingDecline, `ma:n:${code}`);
  if (appUrl) keyboard.row().webApp(t.bot.meetingButton, `${appUrl}/?meeting=${args.meeting.id}`);
  const chat_id = person.telegramId;
  const key = `meeting:${code}:${chat_id}:${Date.now()}`;
  // The poster goes first on its own, so the message with the buttons arrives even if
  // Telegram can't fetch the picture.
  if (args.posterUrl && appUrl) {
    await enqueue(db, {
      chatId: chat_id,
      method: 'sendPhoto',
      payload: { chat_id, photo: `${appUrl}${args.posterUrl}` },
      dedupeKey: `${key}:photo`,
    });
  }
  await enqueue(db, {
    chatId: chat_id,
    method: 'sendMessage',
    payload: { chat_id, text: html, parse_mode: 'HTML', reply_markup: keyboard },
    dedupeKey: key,
  });
  return true;
}

/**
 * The assigned person pressed "Agree" or "Can't". Agreeing marks them confirmed; not
 * being able to frees the slot. Whoever sent the message is told either way.
 */
export async function answerMeetingRole(
  db: Db,
  api: Api,
  args: { meetingId: number; role: Role; agree: boolean; user: User },
): Promise<'ok' | 'not_yours'> {
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, args.meetingId) });
  const assigned = args.role === 'leader' ? meeting?.leaderUserId : meeting?.snackUserId;
  if (!meeting || assigned !== args.user.id) return 'not_yours';
  const now = new Date().toISOString();
  await db
    .update(meetings)
    .set(
      args.agree
        ? args.role === 'leader'
          ? { leaderAcceptedAt: now }
          : { snackAcceptedAt: now }
        : args.role === 'leader'
          ? { leaderUserId: null, leaderNotifiedAt: null, leaderAcceptedAt: null }
          : { snackUserId: null, snackNotifiedAt: null, snackAcceptedAt: null },
    )
    .where(eq(meetings.id, meeting.id));

  const senderId = args.role === 'leader' ? meeting.leaderNotifiedBy : meeting.snackNotifiedBy;
  const sender = senderId
    ? await db.query.users.findFirst({ where: eq(users.id, senderId) })
    : undefined;
  if (sender?.telegramId && sender.id !== args.user.id) {
    const locale = localeOf(sender, await churchDefaultLocale(db));
    const t = messages(locale);
    const { date } = await wording(db, meeting, locale, 0);
    const role = args.role === 'leader' ? t.bot.roleLeader : t.bot.roleSnack;
    const text = (args.agree ? t.bot.meetingAgreedNotice : t.bot.meetingDeclinedNotice)(
      displayName(args.user),
      role,
      meeting.title,
      date,
    );
    await api.sendMessage(sender.telegramId, text).catch(() => undefined);
  }
  return 'ok';
}
