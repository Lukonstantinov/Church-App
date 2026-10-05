import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { messages } from '@church/shared';
import type { Env } from '../env';
import type { Db } from '../db/client';
import { events, groups, meetings, memberships, users } from '../db/schema';
import { churchDefaultLocale, getAppUrl, localeOf } from './church';
import { sendEventReminder } from './eventReminder';
import { escapeHtml } from './html';
import { audienceOf } from './meetings';
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
