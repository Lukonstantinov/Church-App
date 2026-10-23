import { and, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { reminderPlanSchema, type ReminderPlan, type ReminderSlot } from '@church/shared';
import type { Db } from '../db/client';
import {
  eventRoleAssignees,
  eventRoles,
  eventRsvps,
  events,
  groups,
  jobRuns,
  type events as eventsTable,
} from '../db/schema';
import { getAppUrl } from './church';
import { sendEventReminder } from './eventReminder';

type Event = typeof eventsTable.$inferSelect;
const MIN_MS = 60_000;

export function readPlan(raw: string | null): ReminderPlan | null {
  if (!raw) return null;
  try {
    const p = reminderPlanSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

const period = (minutes: number, event: Event) => `${minutes}:${event.startsAt}`;

/** The sends a plan makes for this event, with which have gone. */
export async function planSlots(db: Db, event: Event): Promise<ReminderSlot[]> {
  const plan = readPlan(event.reminderPlan);
  if (!plan) return [];
  const done = await db
    .select({ period: jobRuns.period })
    .from(jobRuns)
    .where(and(eq(jobRuns.job, 'event_remind'), eq(jobRuns.scope, String(event.id))));
  const sent = new Set(done.map((d) => d.period));
  return [...plan.minutes]
    .sort((a, b) => b - a)
    .map((minutes) => ({
      minutes,
      at: new Date(Date.parse(event.startsAt) - minutes * MIN_MS).toISOString(),
      sent: sent.has(period(minutes, event)),
    }));
}

/**
 * Marks the sends whose time has already passed as done, so saving a plan on an event
 * that is soon (or moving an event) doesn't fire them all at once.
 */
export async function skipPassedSlots(db: Db, event: Event, now = new Date()) {
  const plan = readPlan(event.reminderPlan);
  if (!plan) return;
  for (const minutes of plan.minutes)
    if (Date.parse(event.startsAt) - minutes * MIN_MS <= now.getTime())
      await db
        .insert(jobRuns)
        .values({ job: 'event_remind', scope: String(event.id), period: period(minutes, event) })
        .onConflictDoNothing();
}

async function audienceIds(db: Db, event: Event, audience: ReminderPlan['audience']) {
  if (audience === 'going')
    return (
      await db
        .select({ id: eventRsvps.userId })
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, event.id), eq(eventRsvps.status, 'going')))
    ).map((r) => r.id);
  if (audience === 'serving')
    return (
      await db
        .select({ id: eventRoleAssignees.userId })
        .from(eventRoleAssignees)
        .innerJoin(eventRoles, eq(eventRoles.id, eventRoleAssignees.roleId))
        .where(eq(eventRoles.eventId, event.id))
    ).map((r) => r.id);
  return null;
}

/**
 * Events with their own plan are reminded at each of its times (claimed per time first, so
 * a moved event is reminded again and nothing goes twice). When several times are due at
 * once only one message goes. Runs every 5 minutes.
 */
export async function sendPlannedEventReminders(db: Db, env: { APP_URL?: string }, now: Date) {
  const rows = await db
    .select()
    .from(events)
    .innerJoin(groups, eq(groups.id, events.groupId))
    .where(
      and(
        isNotNull(events.reminderPlan),
        eq(events.status, 'scheduled'),
        gte(events.startsAt, now.toISOString()),
        lte(events.startsAt, new Date(now.getTime() + 14 * 24 * 60 * MIN_MS).toISOString()),
        isNull(groups.archivedAt),
      ),
    );
  const appUrl = await getAppUrl(db, env.APP_URL);
  for (const { events: event } of rows) {
    const plan = readPlan(event.reminderPlan);
    if (!plan) continue;
    const left = (Date.parse(event.startsAt) - now.getTime()) / MIN_MS;
    let send = false;
    for (const minutes of plan.minutes.filter((m) => left <= m)) {
      const fresh = await db
        .insert(jobRuns)
        .values({ job: 'event_remind', scope: String(event.id), period: period(minutes, event) })
        .onConflictDoNothing()
        .returning({ job: jobRuns.job });
      if (fresh.length) send = true;
    }
    if (!send) continue;
    const ids = await audienceIds(db, event, plan.audience);
    // sendEventReminder treats an empty list as "everyone": an empty audience gets nothing.
    if (ids && ids.length === 0) continue;
    await sendEventReminder(db, {
      event,
      group: { id: event.groupId },
      userIds: ids,
      fallbackUrl: appUrl,
      envAppUrl: env.APP_URL,
      roster: true,
      dedupe: `plan:${event.startsAt}:${Math.floor(left)}`,
      poster: plan.picture !== 'none',
      posterMediaId: plan.picture === 'moving' ? (plan.mediaId ?? null) : null,
    });
  }
}
