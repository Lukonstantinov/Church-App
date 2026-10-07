import { and, eq, inArray } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { INTL_LOCALE, displayName, messages, peopleLookSchema, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import { memberships, users, type Meeting } from '../db/schema';
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { audienceOf, helpersOf, meetingPeople } from './meetings';
import { recordNotification } from './notifications';
import { enqueue } from './outbox';

/** The icons chosen for the leader and the snack person (or the usual ones). */
function roleIcons(meeting: Meeting) {
  let leader = '🎙';
  let snack = '🍕';
  try {
    const r = peopleLookSchema.safeParse(JSON.parse(meeting.peopleLook ?? 'null'));
    if (r.success) {
      leader = r.data.leaderIcon ?? leader;
      snack = r.data.snackIcon ?? snack;
    }
  } catch {
    // An unreadable look keeps the usual icons.
  }
  return { leader, snack };
}

/**
 * Who does what at a meeting, one line each: the leader, the speakers, the snack
 * person, then the other services ("🎙 Leader — Name"). Empty when nobody is chosen.
 */
export async function meetingRosterLines(
  db: Db,
  meeting: Meeting,
  locale: Locale,
): Promise<{ lines: string[]; userIds: number[] }> {
  const t = messages(locale);
  const icons = roleIcons(meeting);
  const [people, helpers] = await Promise.all([
    meetingPeople(db, [meeting.leaderUserId, meeting.snackUserId]),
    helpersOf(db, [meeting.id]),
  ]);
  const list = helpers.get(meeting.id) ?? [];
  const line = (icon: string | null, role: string, name: string) =>
    `${icon ? `${icon} ` : '• '}${role} — ${name}`;
  const lines: string[] = [];
  const userIds: number[] = [];
  const leader = meeting.leaderUserId ? people.get(meeting.leaderUserId) : null;
  if (leader) {
    lines.push(line(icons.leader, t.meetings.leader, displayName(leader)));
    userIds.push(leader.id);
  }
  for (const h of list.filter((x) => x.speaker)) {
    lines.push(line(h.icon, h.role, displayName(h.person)));
    userIds.push(h.person.id);
  }
  const snack = meeting.snackUserId ? people.get(meeting.snackUserId) : null;
  if (snack) {
    lines.push(line(icons.snack, t.meetings.forFood, displayName(snack)));
    userIds.push(snack.id);
  }
  for (const h of list.filter((x) => !x.speaker)) {
    lines.push(line(h.icon, h.role, displayName(h.person)));
    userIds.push(h.person.id);
  }
  return { lines, userIds: [...new Set(userIds)] };
}

/**
 * Sends the list of who serves (like an event's "who is responsible for what"): to
 * everyone the meeting is for, or only to the people on the list. Kept in the app's
 * notifications too. Returns how many people the bot could reach.
 */
export async function sendMeetingRoster(
  db: Db,
  args: {
    meeting: Meeting;
    to: 'everyone' | 'team';
    senderName: string;
    envAppUrl?: string;
    fallbackUrl: string | null;
  },
): Promise<{ total: number; bot: number }> {
  const { meeting } = args;
  const fallback = await churchDefaultLocale(db);
  const team = (await meetingRosterLines(db, meeting, fallback)).userIds;
  const audience = (await audienceOf(db, [meeting.id])).get(meeting.id) ?? null;
  const only = args.to === 'team' ? team : audience;
  if (only && only.length === 0) return { total: 0, bot: 0 };
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
        ...(only ? [inArray(users.id, only)] : []),
      ),
    );
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const { timezone } = await getChurch(db);
  const stamp = Date.now();
  let bot = 0;
  for (const p of people) {
    const locale = localeOf({ locale: p.locale }, fallback);
    const t = messages(locale);
    const { lines } = await meetingRosterLines(db, meeting, locale);
    const when = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(meeting.startsAt));
    await recordNotification(db, {
      userId: p.id,
      kind: 'meeting_announce',
      title: `👥 ${t.bot.meetingRosterTitle} · ${meeting.title}`,
      body: `${when}\n${lines.join('\n')}\n${t.bot.sentBy(args.senderName)}`,
      link: { type: 'task', meetingId: meeting.id },
    });
    if (!p.chatId || !p.reachable) continue;
    const html = [
      `👥 <b>${escapeHtml(t.bot.meetingRosterTitle)}</b>`,
      `«${escapeHtml(meeting.title)}» · ${when}`,
      '',
      ...lines.map(escapeHtml),
      '',
      `<i>${escapeHtml(t.bot.sentBy(args.senderName))}</i>`,
    ].join('\n');
    await enqueue(db, {
      chatId: p.chatId,
      method: 'sendMessage',
      payload: {
        chat_id: p.chatId,
        text: html,
        parse_mode: 'HTML',
        reply_markup: appUrl
          ? new InlineKeyboard().webApp(t.bot.meetingButton, `${appUrl}/?meeting=${meeting.id}`)
          : undefined,
      },
      dedupeKey: `mtgroster:${meeting.id}:${p.chatId}:${stamp}`,
    });
    bot++;
  }
  return { total: people.length, bot };
}
