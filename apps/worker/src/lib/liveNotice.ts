import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { INTL_LOCALE, messages } from '@church/shared';
import type { Env } from '../env';
import type { Db } from '../db/client';
import { events, groups, meetings, memberships, users } from '../db/schema';
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { sendEventReminder } from './eventReminder';
import { escapeHtml } from './html';
import { audienceOf } from './meetings';
import { meetingRosterLines } from './meetingRoster';
import { recordNotification } from './notifications';
import { enqueue } from './outbox';

/** How long after the start a "live" message may still go out (a late run still tells people). */
const LATE_MS = 30 * 60_000;

/**
 * Tells people the moment an event or meeting begins: "🔴 LIVE now", with the event's
 * poster when it has one and a button to open it. Each goes out once (marked first, so
 * a failure never sends it twice); one that was missed by more than half an hour is
 * not announced late.
 */
export async function sendLiveNotices(db: Db, env: Env, now: Date) {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - LATE_MS).toISOString();
  const appUrl = await getAppUrl(db, env.APP_URL);

  const startedEvents = await db
    .select({ event: events })
    .from(events)
    .innerJoin(groups, eq(groups.id, events.groupId))
    .where(
      and(
        eq(events.status, 'scheduled'),
        isNull(events.liveNotifiedAt),
        lte(events.startsAt, nowIso),
        gte(events.startsAt, since),
        isNull(groups.archivedAt),
      ),
    );
  for (const { event } of startedEvents) {
    const claimed = await db
      .update(events)
      .set({ liveNotifiedAt: nowIso })
      .where(and(eq(events.id, event.id), isNull(events.liveNotifiedAt)))
      .returning({ id: events.id });
    if (claimed.length === 0) continue;
    await sendEventReminder(db, {
      event,
      group: { id: event.groupId },
      fallbackUrl: appUrl,
      envAppUrl: env.APP_URL,
      dedupe: 'live',
      live: true,
    });
  }

  const startedMeetings = await db
    .select({ meeting: meetings })
    .from(meetings)
    .innerJoin(groups, eq(groups.id, meetings.groupId))
    .where(
      and(
        eq(meetings.status, 'scheduled'),
        isNull(meetings.liveNotifiedAt),
        lte(meetings.startsAt, nowIso),
        gte(meetings.startsAt, since),
        isNull(groups.archivedAt),
      ),
    );
  const fallback = await churchDefaultLocale(db);
  for (const { meeting } of startedMeetings) {
    const claimed = await db
      .update(meetings)
      .set({ liveNotifiedAt: nowIso })
      .where(and(eq(meetings.id, meeting.id), isNull(meetings.liveNotifiedAt)))
      .returning({ id: meetings.id });
    if (claimed.length === 0) continue;
    const audience = (await audienceOf(db, [meeting.id])).get(meeting.id);
    const people = await db
      .select({
        id: users.id,
        chatId: users.telegramId,
        reachable: users.isReachable,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupId, meeting.groupId), eq(memberships.status, 'active')));
    for (const p of people) {
      if (audience && !audience.includes(p.id)) continue;
      const t = messages(localeOf({ locale: p.locale }, fallback)).bot;
      await recordNotification(db, {
        userId: p.id,
        kind: 'meeting_announce',
        title: t.notifLiveTitle(meeting.title),
        body: meeting.location ?? '',
        link: { type: 'task', meetingId: meeting.id },
      });
      if (!p.chatId || !p.reachable) continue;
      await enqueue(db, {
        chatId: p.chatId,
        method: 'sendMessage',
        payload: {
          chat_id: p.chatId,
          text: t.meetingLive(
            escapeHtml(meeting.title),
            meeting.location ? escapeHtml(meeting.location) : null,
          ),
          parse_mode: 'HTML',
          reply_markup: appUrl
            ? new InlineKeyboard().webApp(
                t.meetingButton,
                `${appUrl.replace(/\/+$/, '')}/?meeting=${meeting.id}`,
              )
            : undefined,
        },
        dedupeKey: `mtglive:${meeting.id}:${p.chatId}`,
      });
    }
  }
}

/** Hours before a meeting its reminder goes: the ministry's choice, 2 by default, 0 = off. */
const reminderHours = (v: number | null) => v ?? 2;

/**
 * "⏰ Meeting soon": a set time before each meeting (2 hours unless the ministry chose
 * otherwise), to everyone it is for, with who serves and a button into it. Once per
 * meeting (marked first); a meeting made in the last 10 minutes waits a little, so its
 * own announcement isn't followed at once by a reminder.
 */
export async function sendMeetingReminders(db: Db, env: Env, now: Date) {
  const nowIso = now.toISOString();
  const rows = await db
    .select({ meeting: meetings, hours: groups.meetingReminderHours, groupName: groups.name })
    .from(meetings)
    .innerJoin(groups, eq(groups.id, meetings.groupId))
    .where(
      and(
        eq(meetings.status, 'scheduled'),
        isNull(meetings.remindedAt),
        gte(meetings.startsAt, nowIso),
        lte(meetings.startsAt, new Date(now.getTime() + 48 * 3_600_000).toISOString()),
        lte(meetings.createdAt, new Date(now.getTime() - 10 * 60_000).toISOString()),
        isNull(groups.archivedAt),
      ),
    );
  const due = rows.filter(({ meeting, hours }) => {
    const h = reminderHours(hours);
    return h > 0 && Date.parse(meeting.startsAt) - now.getTime() <= h * 3_600_000;
  });
  if (due.length === 0) return;
  const appUrl = (await getAppUrl(db, env.APP_URL))?.replace(/\/+$/, '');
  const fallback = await churchDefaultLocale(db);
  const { timezone } = await getChurch(db);
  for (const { meeting } of due) {
    const claimed = await db
      .update(meetings)
      .set({ remindedAt: nowIso })
      .where(and(eq(meetings.id, meeting.id), isNull(meetings.remindedAt)))
      .returning({ id: meetings.id });
    if (claimed.length === 0) continue;
    const audience = (await audienceOf(db, [meeting.id])).get(meeting.id);
    const people = await db
      .select({
        id: users.id,
        chatId: users.telegramId,
        reachable: users.isReachable,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupId, meeting.groupId), eq(memberships.status, 'active')));
    for (const p of people) {
      if (audience && !audience.includes(p.id)) continue;
      const locale = localeOf({ locale: p.locale }, fallback);
      const t = messages(locale);
      const when = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(meeting.startsAt));
      const { lines } = await meetingRosterLines(db, meeting, locale);
      await recordNotification(db, {
        userId: p.id,
        kind: 'meeting_announce',
        title: `⏰ ${meeting.title}`,
        body: [when, meeting.location, ...lines].filter(Boolean).join('\n'),
        link: { type: 'task', meetingId: meeting.id },
      });
      if (!p.chatId || !p.reachable) continue;
      let html = t.bot.meetingReminder(
        escapeHtml(meeting.title),
        when,
        meeting.location ? escapeHtml(meeting.location) : null,
      );
      if (lines.length)
        html += `\n\n👥 <b>${escapeHtml(t.bot.meetingRosterTitle)}</b>\n${lines.map(escapeHtml).join('\n')}`;
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
        dedupeKey: `mtgremind:${meeting.id}:${p.chatId}`,
      });
    }
  }
}
