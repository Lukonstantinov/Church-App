import { and, eq, inArray } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import {
  INTL_LOCALE,
  displayName,
  readSpeakers,
  messages,
  type Locale,
  type MeetingNotice,
  type MeetingRsvpStatus,
} from '@church/shared';
import type { Db } from '../db/client';
import { meetingRsvps, memberships, users, type Meeting, type User } from '../db/schema';
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { audienceOf } from './meetings';
import { recordNotification } from './notifications';
import { enqueue } from './outbox';

/** Day and time of a meeting in the church zone and the reader's language. */
async function whenText(db: Db, startsAt: string, endsAt: string | null, locale: Locale) {
  const { timezone } = await getChurch(db);
  const intl = INTL_LOCALE[locale];
  const day = new Intl.DateTimeFormat(intl, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(startsAt));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(intl, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  return `${day}, ${time(startsAt)}${endsAt ? `–${time(endsAt)}` : ''}`;
}

/**
 * The default message about a meeting, as plain text the sender can change:
 * - announce: title, topic, when, where, who leads, the notes;
 * - changed: the new time next to the old one;
 * - cancelled: that it won't take place.
 */
export async function defaultMeetingAnnouncement(
  db: Db,
  meeting: Meeting,
  locale: Locale,
  notice: MeetingNotice = 'announce',
  previousStartsAt?: string | null,
): Promise<string> {
  const t = messages(locale).bot;
  const when = await whenText(db, meeting.startsAt, meeting.endsAt, locale);
  if (notice === 'cancelled')
    return [`❌ ${t.meetingCancelled}`, `«${meeting.title}»`, `🗓 ${when}`]
      .filter(Boolean)
      .join('\n');
  if (notice === 'changed') {
    const was = previousStartsAt ? await whenText(db, previousStartsAt, null, locale) : null;
    return [
      `🕒 ${t.meetingChanged}`,
        `«${meeting.title}»`,
      '',
      was ? `${t.meetingWas}: ${was}` : null,
      `${t.meetingNow}: ${when}`,
      meeting.location ? `📍 ${meeting.location}` : null,
    ]
      .filter((x) => x !== null)
      .join('\n');
  }
  const leader = meeting.leaderUserId
    ? await db.query.users.findFirst({ where: eq(users.id, meeting.leaderUserId) })
    : null;
  const speakers = readSpeakers(meeting.speakers);
  return [
    `📣 ${meeting.title}`,
    meeting.topic ? `«${meeting.topic}»` : null,
    '',
    `🗓 ${when}`,
    meeting.location ? `📍 ${meeting.location}` : null,
    leader ? `🎤 ${t.whoLeads}: ${displayName(leader)}` : null,
    speakers.length ? `🎙 ${speakers.map((sp) => sp.name).join(', ')}` : null,
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
    notice?: MeetingNotice;
    /** Add "I'll come / Can't" buttons. */
    ask?: boolean;
    previousStartsAt?: string | null;
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
    const text =
      args.text ??
      (await defaultMeetingAnnouncement(db, meeting, locale, args.notice, args.previousStartsAt));
    const [first, ...rest] = escapeHtml(text).split('\n');
    const ask = args.ask && args.notice !== 'cancelled';
    const html = `${[`<b>${first}</b>`, ...rest].join('\n')}${
      ask ? `\n\n<b>${escapeHtml(t.rsvpAskLine)}</b>` : ''
    }\n\n<i>${escapeHtml(t.sentBy(args.senderName))}</i>`;
    await recordNotification(db, {
      userId: p.id,
      kind: 'meeting_announce',
      title: t.notifMeetingTitle(meeting.title),
      body: `${text}\n${t.sentBy(args.senderName)}`,
      link: { type: 'task', meetingId: meeting.id },
    });
    if (!p.chatId || !p.reachable) continue;
    const kb = new InlineKeyboard();
    if (ask) kb.text(t.rsvpYes, `mr:y:${meeting.id}`).text(t.rsvpNo, `mr:n:${meeting.id}`).row();
    if (appUrl) kb.webApp(t.meetingButton, `${appUrl}/?meeting=${meeting.id}`);
    const reply_markup = ask || appUrl ? kb : undefined;
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

/**
 * A person answers "Will you come?": the answer is saved (it can be changed), and the
 * person who sent the message hears it — in the app's notifications and from the bot.
 * Returns false when the person isn't one of the meeting's people.
 */
export async function answerMeetingRsvp(
  db: Db,
  args: {
    meeting: Meeting;
    user: User;
    status: MeetingRsvpStatus;
    envAppUrl?: string;
    fallbackUrl: string | null;
  },
): Promise<boolean> {
  const { meeting, user } = args;
  const member = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.groupId, meeting.groupId),
      eq(memberships.userId, user.id),
      eq(memberships.status, 'active'),
    ),
  });
  const audience = (await audienceOf(db, [meeting.id])).get(meeting.id);
  if (!member || (audience && !audience.includes(user.id))) return false;
  const now = new Date().toISOString();
  const before = await db.query.meetingRsvps.findFirst({
    where: and(eq(meetingRsvps.meetingId, meeting.id), eq(meetingRsvps.userId, user.id)),
  });
  await db
    .insert(meetingRsvps)
    .values({ meetingId: meeting.id, userId: user.id, status: args.status, updatedAt: now })
    .onConflictDoUpdate({
      target: [meetingRsvps.meetingId, meetingRsvps.userId],
      set: { status: args.status, updatedAt: now },
    });
  // Same answer twice: nothing new to tell.
  if (before?.status === args.status) return true;
  const toId = meeting.announcedBy;
  const to = toId ? await db.query.users.findFirst({ where: eq(users.id, toId) }) : null;
  if (!to || to.id === user.id) return true;
  const fallback = await churchDefaultLocale(db);
  const t = messages(localeOf(to, fallback)).bot;
  const line = t.rsvpTold(displayName(user), args.status === 'going', meeting.title);
  await recordNotification(db, {
    userId: to.id,
    kind: 'meeting_rsvp',
    title: t.notifRsvpTitle(meeting.title),
    body: line,
    link: { type: 'task', meetingId: meeting.id },
  });
  if (to.telegramId && to.isReachable) {
    const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
    await enqueue(db, {
      chatId: to.telegramId,
      method: 'sendMessage',
      payload: {
        chat_id: to.telegramId,
        text: escapeHtml(line),
        parse_mode: 'HTML',
        reply_markup: appUrl
          ? new InlineKeyboard().webApp(t.meetingButton, `${appUrl}/?meeting=${meeting.id}`)
          : undefined,
      },
      dedupeKey: `mtgrsvp:${meeting.id}:${user.id}:${now}`,
    });
  }
  return true;
}

/** Who answered, for the meeting page. */
export async function meetingRsvpLists(db: Db, meetingId: number) {
  const rows = await db
    .select({
      status: meetingRsvps.status,
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(meetingRsvps)
    .innerJoin(users, eq(users.id, meetingRsvps.userId))
    .where(eq(meetingRsvps.meetingId, meetingId))
    .orderBy(users.firstName);
  const person = (r: (typeof rows)[number]) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    username: r.username,
  });
  return {
    rows,
    going: rows.filter((r) => r.status === 'going').map(person),
    notGoing: rows.filter((r) => r.status === 'not_going').map(person),
  };
}
