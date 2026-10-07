import { and, asc, eq } from 'drizzle-orm';
import { InlineKeyboard, type Api } from 'grammy';
import { INTL_LOCALE, displayName, messages, type MeetingHelper } from '@church/shared';
import type { Db } from '../db/client';
import { groups, meetingHelpers, meetings, users, type User } from '../db/schema';
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { meetingPeople } from './meetings';
import { recordNotification } from './notifications';
import { enqueue } from './outbox';

/** The other people with a job at a meeting, in the order they were added. */
export async function listHelpers(
  db: Db,
  meetingId: number,
  secret?: string,
): Promise<MeetingHelper[]> {
  const rows = await db
    .select()
    .from(meetingHelpers)
    .where(eq(meetingHelpers.meetingId, meetingId))
    .orderBy(asc(meetingHelpers.id));
  const people = await meetingPeople(
    db,
    rows.map((r) => r.userId),
    secret,
  );
  return rows
    .filter((r) => people.has(r.userId))
    .map((r) => ({
      id: r.id,
      role: r.role,
      person: people.get(r.userId)!,
      notifiedAt: r.notifiedAt,
      acceptedAt: r.acceptedAt,
      declinedAt: r.declinedAt,
    }));
}

/**
 * Asks a helper by bot: what they're asked to do, with "Agree" / "Can't" and a way into
 * the meeting. Kept in the app's notifications too. Returns false when the bot can't
 * reach them.
 */
export async function notifyHelper(
  db: Db,
  args: {
    helperId: number;
    senderId: number;
    senderName: string;
    envAppUrl?: string;
    fallbackUrl: string | null;
  },
): Promise<boolean> {
  const helper = await db.query.meetingHelpers.findFirst({
    where: eq(meetingHelpers.id, args.helperId),
  });
  if (!helper) return false;
  const meeting = (await db.query.meetings.findFirst({
    where: eq(meetings.id, helper.meetingId),
  }))!;
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, meeting.groupId) }))!;
  const person = await db.query.users.findFirst({ where: eq(users.id, helper.userId) });
  if (!person) return false;
  const locale = localeOf(person, await churchDefaultLocale(db));
  const t = messages(locale);
  const { timezone } = await getChurch(db);
  const date = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(meeting.startsAt));
  const html = `${t.bot.meetingHelper(
    escapeHtml(helper.role),
    escapeHtml(meeting.title),
    escapeHtml(group.name),
    date,
  )}\n\n<i>${escapeHtml(t.bot.sentBy(args.senderName))}</i>`;
  await recordNotification(db, {
    userId: person.id,
    kind: 'meeting_job',
    title: `${helper.role} · ${meeting.title}`,
    body: `${date}\n${t.bot.sentBy(args.senderName)}`,
    link: { type: 'task', meetingId: meeting.id },
  });
  const now = new Date().toISOString();
  await db
    .update(meetingHelpers)
    .set({ notifiedAt: now, notifiedBy: args.senderId, acceptedAt: null, declinedAt: null })
    .where(eq(meetingHelpers.id, helper.id));
  if (!person.telegramId || !person.isReachable) return false;
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const kb = new InlineKeyboard()
    .text(t.bot.meetingAgree, `mh:y:${helper.id}`)
    .text(t.bot.meetingDecline, `mh:n:${helper.id}`);
  if (appUrl) kb.row().webApp(t.bot.meetingButton, `${appUrl}/?meeting=${meeting.id}`);
  await enqueue(db, {
    chatId: person.telegramId,
    method: 'sendMessage',
    payload: { chat_id: person.telegramId, text: html, parse_mode: 'HTML', reply_markup: kb },
    dedupeKey: `mhelper:${helper.id}:${now}`,
  });
  return true;
}

/** A helper pressed "Agree" or "Can't": the mark changes and whoever asked is told. */
export async function answerHelper(
  db: Db,
  api: Api,
  args: { helperId: number; agree: boolean; user: User },
): Promise<{ meetingId: number } | 'not_yours'> {
  const helper = await db.query.meetingHelpers.findFirst({
    where: and(eq(meetingHelpers.id, args.helperId), eq(meetingHelpers.userId, args.user.id)),
  });
  if (!helper) return 'not_yours';
  const now = new Date().toISOString();
  await db
    .update(meetingHelpers)
    .set(args.agree ? { acceptedAt: now, declinedAt: null } : { declinedAt: now, acceptedAt: null })
    .where(eq(meetingHelpers.id, helper.id));
  const meeting = (await db.query.meetings.findFirst({
    where: eq(meetings.id, helper.meetingId),
  }))!;
  const sender = helper.notifiedBy
    ? await db.query.users.findFirst({ where: eq(users.id, helper.notifiedBy) })
    : undefined;
  if (sender?.telegramId && sender.id !== args.user.id) {
    const locale = localeOf(sender, await churchDefaultLocale(db));
    const t = messages(locale);
    const { timezone } = await getChurch(db);
    const date = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: timezone,
      day: 'numeric',
      month: 'long',
    }).format(new Date(meeting.startsAt));
    const text = (args.agree ? t.bot.meetingAgreedNotice : t.bot.meetingDeclinedNotice)(
      displayName(args.user),
      helper.role,
      meeting.title,
      date,
    );
    await api.sendMessage(sender.telegramId, text).catch(() => undefined);
  }
  return { meetingId: meeting.id };
}
