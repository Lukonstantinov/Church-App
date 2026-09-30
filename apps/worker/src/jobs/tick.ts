import { and, eq, gte, lt } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { DAY_MS, HOUR_MS, INTL_LOCALE, messages, type Locale } from '@church/shared';
import type { Env } from '../env';
import { getDb, type Db } from '../db/client';
import { groups, jobRuns, meetings, outbox } from '../db/schema';
import { getAppUrl, getChurch } from '../lib/church';
import { escapeHtml } from '../lib/html';
import { generateMeetings } from '../lib/meetings';
import { leaderRecipients } from '../lib/membership';
import { drainOutbox, enqueue } from '../lib/outbox';
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

/** Hourly: create upcoming meetings, nudge leaders about missing roll calls, tidy up. */
export async function hourlyTick(env: Env, now = new Date()): Promise<void> {
  const db = getDb(env.DB);
  const church = await getChurch(db);

  await generateMeetings(db, church.timezone, { now });
  await remindMissingRollCalls(db, env, church.timezone, now);

  if (await claim(db, 'housekeeping', 'all', now.toISOString().slice(0, 10))) {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    await db.delete(outbox).where(and(eq(outbox.status, 'sent'), lt(outbox.createdAt, cutoff)));
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
    for (const r of await leaderRecipients(db, meeting.groupId)) {
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

export async function runScheduled(cron: string, env: Env, now = new Date()): Promise<void> {
  if (cron === CRON_HOURLY) await hourlyTick(env, now);
  // Both schedules end by sending whatever is due (the hourly one just queued reminders).
  await drainOutbox(getDb(env.DB), botApi(env), { now });
}
