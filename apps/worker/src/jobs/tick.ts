import { pruneDownloads } from '../lib/downloads';
import { and, eq, gte, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import {
  DAY_MS,
  HOUR_MS,
  INTL_LOCALE,
  localDate,
  messages,
  type BirthdayReport,
  type Locale,
} from '@church/shared';
import type { Env } from '../env';
import { getDb, type Db } from '../db/client';
import { events, groups, jobRuns, meetings, outbox } from '../db/schema';
import {
  adminRecipients,
  birthdayMessage,
  birthdayRows,
  comingBirthdays,
  syncTelegramBirthdays,
} from '../lib/birthdays';
import { sendEventReminder } from '../lib/eventReminder';
import { sendPlannedEventReminders } from '../lib/eventReminderPlan';
import { sendLiveNotices, sendMeetingReminders } from '../lib/liveNotice';
import { pruneReminderVideos } from '../lib/media';
import { pruneNotifications } from '../lib/notifications';
import { getAppUrl, getChurch } from '../lib/church';
import { escapeHtml } from '../lib/html';
import { generateMeetings } from '../lib/meetings';
import { leaderRecipients } from '../lib/membership';
import { clearEndedLive, drainOutbox, enqueue } from '../lib/outbox';
import { syncBirthdayMenus } from '../lib/botMenu';
import { botApi } from '../lib/telegram';

export const CRON_OUTBOX = '*/5 * * * *';
export const CRON_HOURLY = '7 * * * *';

/** Records that (job, scope, period) ran; false if it already had, so it never runs twice. */
async function claim(db: Db, job: string, scope: string, period: string): Promise<boolean> {
  const rows = await db
    .insert(jobRuns)
    .values({ job, scope, period })
    .onConflictDoNothing()
    .returning({ job: jobRuns.job });
  return rows.length > 0;
}

/** Every 5 minutes: "it's live" messages and event and meeting reminders that have come due. */
export async function minuteTick(env: Env, now = new Date()): Promise<void> {
  const db = getDb(env.DB);
  await sendLiveNotices(db, env, now);
  await remindUpcomingEvents(db, env, now);
  await sendMeetingReminders(db, env, now);
  await clearEndedLive(db, botApi(env), now);
  // Every 5 minutes, so a birthday list set for 16:30 comes at 16:30, not at the next hour.
  await sendBirthdayReports(db, await getChurch(db), now, botApi(env));
}

/** Hourly: create upcoming meetings, nudge leaders about missing roll calls, tidy up. */
export async function hourlyTick(env: Env, now = new Date()): Promise<void> {
  const db = getDb(env.DB);
  const church = await getChurch(db);

  await generateMeetings(db, church.timezone, { now });
  await remindMissingRollCalls(db, env, church.timezone, now);
  await remindUpcomingEvents(db, env, now);
  await sendLiveNotices(db, env, now);
  await syncBirthdayMenus(db, botApi(env), env, (userId) =>
    claim(db, 'cmd_menu', String(userId), now.toISOString().slice(0, 10)),
  ).catch(() => 0);

  if (await claim(db, 'housekeeping', 'all', now.toISOString().slice(0, 10))) {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    await db.delete(outbox).where(and(eq(outbox.status, 'sent'), lt(outbox.createdAt, cutoff)));
    await pruneNotifications(db, now);
    await pruneReminderVideos(db, now);
    await pruneDownloads(db, now);
    await db
      .delete(jobRuns)
      .where(lt(jobRuns.ranAt, new Date(now.getTime() - 60 * DAY_MS).toISOString()));
  }
}

/** Minutes of the day, church time. */
function minuteOfDay(now: Date, timezone: string) {
  const [h = 0, m = 0] = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  })
    .format(now)
    .split(':')
    .map(Number);
  return h * 60 + m;
}

/**
 * Birthdays for the church admins, at the times set in church settings (church time): once
 * a week on the chosen weekday the list of the coming days, and on the day of a birthday a
 * short note, each at its own hour and minute. Checked every 5 minutes; each is due for an
 * hour from its time (a late or missed tick still sends it) and claimed per day, so it is
 * never sent twice.
 */
export async function sendBirthdayReports(
  db: Db,
  church: { timezone: string; birthdayReport: BirthdayReport },
  now: Date,
  telegram?: Parameters<typeof syncTelegramBirthdays>[1],
) {
  const report = church.birthdayReport;
  if (!report.on && !report.dayOf) return;
  const at = minuteOfDay(now, church.timezone);
  const due = (hour: number, minute: number) => {
    const from = hour * 60 + minute;
    return at >= from && at < from + 60;
  };
  const today = localDate(now, church.timezone);
  // 0 = Monday, as the setting counts.
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const weeklyDue = report.on && weekday === report.weekday && due(report.hour, report.minute ?? 0);
  const dayDue =
    report.dayOf && due(report.dayOfHour ?? report.hour, report.dayOfMinute ?? report.minute ?? 0);
  // Claimed first: a list is never sent twice, and the rest below runs once a day at most.
  const weekly = weeklyDue && (await claim(db, 'birthday_week', 'all', today));
  const dayOf = dayDue && (await claim(db, 'birthday_day', 'all', today));
  if (!weekly && !dayOf) return;
  // Fresh birthdays from people's Telegram profiles go into the list that is about to be sent.
  if (telegram) await syncTelegramBirthdays(db, telegram).catch(() => null);
  const rows = await birthdayRows(db);
  const admins = await adminRecipients(db);
  if (weekly) {
    const list = comingBirthdays(rows, today, report.days);
    if (list.length)
      for (const a of admins)
        await enqueue(db, {
          chatId: a.chatId,
          method: 'sendMessage',
          payload: {
            chat_id: a.chatId,
            text: birthdayMessage(
              a.locale,
              messages(a.locale).birthdays.weekTitle(report.days),
              list,
            ),
            parse_mode: 'HTML',
          },
          dedupeKey: `bday-week:${today}:${a.chatId}`,
        });
  }
  if (dayOf) {
    const list = comingBirthdays(rows, today, 1);
    if (list.length)
      for (const a of admins)
        await enqueue(db, {
          chatId: a.chatId,
          method: 'sendMessage',
          payload: {
            chat_id: a.chatId,
            text: birthdayMessage(a.locale, messages(a.locale).birthdays.todayTitle, list),
            parse_mode: 'HTML',
          },
          dedupeKey: `bday-day:${today}:${a.chatId}`,
        });
  }
}

/**
 * One hour after a meeting ends without a saved roll call, every leader of the group
 * gets a message with a button that opens the roll-call screen directly.
 */
export async function remindMissingRollCalls(db: Db, env: Env, timezone: string, now: Date) {
  const rows = await db
    .select({ meeting: meetings, groupName: groups.name })
    .from(meetings)
    .innerJoin(groups, eq(groups.id, meetings.groupId))
    .where(
      and(
        eq(meetings.status, 'scheduled'),
        lt(meetings.endsAt, new Date(now.getTime() - HOUR_MS).toISOString()),
        gte(meetings.endsAt, new Date(now.getTime() - 2 * DAY_MS).toISOString()),
      ),
    );
  if (rows.length === 0) return;

  const appUrl = await getAppUrl(db, env.APP_URL);
  const formatDate = (iso: string, locale: Locale) =>
    new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'long',
    }).format(new Date(iso));

  for (const { meeting, groupName } of rows) {
    if (!(await claim(db, 'roll_reminder', String(meeting.id), '1'))) continue;
    for (const r of await leaderRecipients(db, meeting.groupId, 'attendance.take')) {
      const t = messages(r.locale);
      const text = t.bot.rollReminder(
        escapeHtml(meeting.title),
        escapeHtml(groupName),
        formatDate(meeting.startsAt, r.locale),
      );
      const reply_markup = appUrl
        ? new InlineKeyboard().webApp(t.bot.rollReminderButton, `${appUrl}/?roll=${meeting.id}`)
        : undefined;
      await enqueue(db, {
        chatId: r.chatId,
        method: 'sendMessage',
        payload: { chat_id: r.chatId, text, parse_mode: 'HTML', reply_markup },
        dedupeKey: `roll:${meeting.id}:${r.chatId}`,
      });
    }
  }
}

/**
 * Ministries can ask the bot to remind everyone about an event a set number of hours
 * ahead. Each event is reminded once, at the first run (every 5 minutes) inside that
 * window; events made less than 10 minutes earlier wait so a new event isn't announced
 * twice at once.
 */
export async function remindUpcomingEvents(db: Db, env: Env, now: Date) {
  // Events with their own plan are handled by it, not by the ministry's rule below.
  await sendPlannedEventReminders(db, env, now);
  const rules = await db
    .select({ id: groups.id, hours: groups.eventReminderHours })
    .from(groups)
    .where(isNotNull(groups.eventReminderHours));
  const appUrl = await getAppUrl(db, env.APP_URL);
  for (const rule of rules) {
    const until = new Date(now.getTime() + rule.hours! * HOUR_MS).toISOString();
    const due = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.groupId, rule.id),
          eq(events.status, 'scheduled'),
          isNull(events.remindedAt),
          isNull(events.reminderPlan),
          gte(events.startsAt, now.toISOString()),
          lte(events.startsAt, until),
          lte(events.createdAt, new Date(now.getTime() - 10 * 60_000).toISOString()),
        ),
      );
    for (const event of due) {
      // Mark first, so a failure while queueing never sends it twice.
      const claimed = await db
        .update(events)
        .set({ remindedAt: now.toISOString() })
        .where(and(eq(events.id, event.id), isNull(events.remindedAt)))
        .returning({ id: events.id });
      if (claimed.length === 0) continue;
      await sendEventReminder(db, {
        event,
        group: { id: rule.id },
        fallbackUrl: appUrl,
        envAppUrl: env.APP_URL,
        roster: true,
        dedupe: 'auto',
      });
    }
  }
}

export async function runScheduled(cron: string, env: Env, now = new Date()): Promise<void> {
  if (cron === CRON_HOURLY) await hourlyTick(env, now);
  else await minuteTick(env, now);
  // Both schedules end by sending whatever is due (the hourly one just queued reminders).
  await drainOutbox(getDb(env.DB), botApi(env), { now });
}
