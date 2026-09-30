import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => text('created_at').notNull().default(now);

/** Single-row church-wide settings (id is always 1). */
export const churchSettings = sqliteTable(
  'church_settings',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull().default('Церковь'),
    timezone: text('timezone').notNull().default('Europe/Riga'),
    currency: text('currency').notNull().default('EUR'),
    privacyVersion: integer('privacy_version').notNull().default(1),
    adminBackupChatId: integer('admin_backup_chat_id'),
    /** Public Mini App origin, saved by /bot/setup so cron jobs can build "open app" buttons. */
    appUrl: text('app_url'),
  },
  (t) => [check('church_settings_singleton', sql`${t.id} = 1`)],
);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** NULL for offline members (no Telegram account linked). */
  telegramId: integer('telegram_id').unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  languageCode: text('language_code'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  /** Set to false when Telegram answers 403 (user blocked the bot). */
  isReachable: integer('is_reachable', { mode: 'boolean' }).notNull().default(true),
  privacyAcceptedAt: text('privacy_accepted_at'),
  privacyVersion: integer('privacy_version'),
  guardianConsentAt: text('guardian_consent_at'),
  guardianConsentBy: integer('guardian_consent_by'),
  claimCode: text('claim_code').unique(),
  claimExpiresAt: text('claim_expires_at'),
  createdAt: createdAt(),
  anonymizedAt: text('anonymized_at'),
});

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  inviteCode: text('invite_code').notNull().unique(),
  inactivityThreshold: integer('inactivity_threshold').notNull().default(3),
  checkinTemplate: text('checkin_template'),
  membersSeeTreasury: integer('members_see_treasury', { mode: 'boolean' }).notNull().default(false),
  archivedAt: text('archived_at'),
  createdAt: createdAt(),
});

export const memberships = sqliteTable(
  'memberships',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    role: text('role', { enum: ['leader', 'member'] })
      .notNull()
      .default('member'),
    status: text('status', { enum: ['pending', 'active', 'left', 'rejected'] })
      .notNull()
      .default('pending'),
    joinedAt: text('joined_at'),
    leftAt: text('left_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('memberships_user_group').on(t.userId, t.groupId),
    index('memberships_group_status').on(t.groupId, t.status),
    check('memberships_role', sql`${t.role} IN ('leader', 'member')`),
    check('memberships_status', sql`${t.status} IN ('pending', 'active', 'left', 'rejected')`),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: integer('actor_user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: integer('entity_id'),
    groupId: integer('group_id'),
    data: text('data', { mode: 'json' }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_entity').on(t.entity, t.entityId)],
);

export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Membership = typeof memberships.$inferSelect;

/**
 * Bot messages with action buttons that were sent to several people (e.g. a join
 * request card to every leader). Stored so all copies can be updated once one
 * person acts.
 */
export const botCards = sqliteTable(
  'bot_cards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['join_request'] }).notNull(),
    refId: integer('ref_id').notNull(),
    chatId: integer('chat_id').notNull(),
    messageId: integer('message_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('bot_cards_ref').on(t.kind, t.refId)],
);

/** Recurring weekly meeting rule; the hourly job turns it into `meetings` rows. */
export const meetingSchedules = sqliteTable(
  'meeting_schedules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    /** 0 = Monday … 6 = Sunday, in the church time zone. */
    weekday: integer('weekday').notNull(),
    /** Wall-clock "HH:MM" in the church time zone. */
    startTime: text('start_time').notNull(),
    durationMin: integer('duration_min').notNull().default(120),
    title: text('title').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('meeting_schedules_group').on(t.groupId),
    check('meeting_schedules_weekday', sql`${t.weekday} BETWEEN 0 AND 6`),
  ],
);

export const meetings = sqliteTable(
  'meetings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    scheduleId: integer('schedule_id').references(() => meetingSchedules.id),
    title: text('title').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    status: text('status', { enum: ['scheduled', 'done', 'cancelled'] })
      .notNull()
      .default('scheduled'),
    guestCount: integer('guest_count').notNull().default(0),
    notes: text('notes'),
    rollTakenBy: integer('roll_taken_by'),
    rollTakenAt: text('roll_taken_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('meetings_group_starts').on(t.groupId, t.startsAt),
    // Makes schedule → meeting generation idempotent.
    uniqueIndex('meetings_schedule_starts').on(t.scheduleId, t.startsAt),
    check('meetings_status', sql`${t.status} IN ('scheduled', 'done', 'cancelled')`),
  ],
);

export const attendance = sqliteTable(
  'attendance',
  {
    meetingId: integer('meeting_id')
      .notNull()
      .references(() => meetings.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['present', 'late', 'excused', 'absent'] }).notNull(),
    markedBy: integer('marked_by'),
    markedAt: text('marked_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.meetingId, t.userId] }),
    index('attendance_user').on(t.userId),
    check('attendance_status', sql`${t.status} IN ('present', 'late', 'excused', 'absent')`),
  ],
);

/**
 * Bot messages waiting to be sent. A cron job drains it in small batches so bulk
 * sends respect Telegram's rate limits and the Worker's subrequest limit.
 */
export const outbox = sqliteTable(
  'outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: integer('chat_id').notNull(),
    method: text('method').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    status: text('status', { enum: ['pending', 'sent', 'dead'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error'),
    /** Prevents queuing the same message twice. */
    dedupeKey: text('dedupe_key').unique(),
    createdAt: createdAt(),
  },
  (t) => [index('outbox_due').on(t.status, t.nextAttemptAt)],
);

/** Marks that a scheduled sub-job already ran for a scope+period, so it never runs twice. */
export const jobRuns = sqliteTable(
  'job_runs',
  {
    job: text('job').notNull(),
    scope: text('scope').notNull(),
    period: text('period').notNull(),
    ranAt: text('ran_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.job, t.scope, t.period] })],
);

export type Meeting = typeof meetings.$inferSelect;
export type MeetingSchedule = typeof meetingSchedules.$inferSelect;
