import { sql } from 'drizzle-orm';
import type { AppBackground, LabelExtra, LabelLook } from '@church/shared';
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Raw bytes in a BLOB column (D1 binds ArrayBuffers and returns them for BLOBs). */
const bytesColumn = customType<{ data: Uint8Array; driverData: ArrayBuffer | number[] }>({
  dataType: () => 'blob',
  toDriver: (v) => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer,
  fromDriver: (v) => (Array.isArray(v) ? Uint8Array.from(v) : new Uint8Array(v)),
});

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
    defaultLocale: text('default_locale').notNull().default('ru'),
    brandColor: text('brand_color').notNull().default('blue'),
    /** Small raster logo (resized in the browser), base64. */
    logoData: text('logo_data'),
    logoMime: text('logo_mime'),
    logoUpdatedAt: text('logo_updated_at'),
    /** The label printed top right on posters and PDFs (empty = the church's name). */
    sheetLabel: text('sheet_label'),
    /** The main window's background (AppBackground JSON; NULL = the default). */
    appBackground: text('app_background', { mode: 'json' }).$type<AppBackground>(),
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
  /** UI language chosen in the app; NULL = church default. */
  locale: text('locale'),
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
  /** Last time the person used the app or the bot (updated at most hourly). */
  lastSeenAt: text('last_seen_at'),
  /** Their photo (a ministry picture), shown on meeting cards instead of initials. */
  photoMediaId: integer('photo_media_id'),
});

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  inviteCode: text('invite_code').notNull().unique(),
  inactivityThreshold: integer('inactivity_threshold').notNull().default(3),
  checkinTemplate: text('checkin_template'),
  membersSeeTreasury: integer('members_see_treasury', { mode: 'boolean' }).notNull().default(false),
  /** Expected monthly dues per paying member, in cents of the church currency. */
  monthlyFeeCents: integer('monthly_fee_cents').notNull().default(500),
  /** Link to the group's Telegram chat (t.me/…), shown to members. */
  chatUrl: text('chat_url'),
  /** Environment theme: a BRAND_COLORS key; NULL = the church colour. */
  brandColor: text('brand_color'),
  logoMediaId: integer('logo_media_id'),
  sort: integer('sort').notNull().default(0),
  /** Telegram group chat run by the bot: only members of the ministry get in. */
  tgChatId: integer('tg_chat_id'),
  tgChatTitle: text('tg_chat_title'),
  /** One-time code in the "add bot to group" link; cleared once the chat is linked. */
  chatLinkCode: text('chat_link_code'),
  /** Decorative pattern over the theme colours (PATTERNS key), NULL = plain. */
  pattern: text('pattern'),
  /** 'auto' | 'light' | 'dark' | '#rrggbb' — text on the ministry's coloured blocks. */
  textColor: text('text_color').notNull().default('auto'),
  /** How the ministry opens (ENTER_ANIMATIONS key). */
  animation: text('animation').notNull().default('rise'),
  /** Colour of the "new posts" counter on the ministry card; NULL = the theme colour. */
  badgeColor: text('badge_color'),
  /** Default food/expense budget per meeting, in cents. */
  meetingBudgetCents: integer('meeting_budget_cents').notNull().default(1500),
  /** Where this ministry's meetings usually are; prefilled when the leader fills in the place. */
  defaultLocation: text('default_location').notNull().default('Šeškinės 22A'),
  /** Automatic reminder to everyone this many hours before an event (null = off). */
  eventReminderHours: integer('event_reminder_hours'),
  /** Remind about meetings this many hours ahead (null = 2 h, 0 = never). */
  meetingReminderHours: integer('meeting_reminder_hours'),
  /** Services people do at meetings, saved for reuse: JSON [{name, icon, speaker}]. */
  meetingServices: text('meeting_services'),
  /** Photo behind the ministry card (BackdropConfig JSON), NULL = colours only. */
  backdrop: text('backdrop'),
  /** The background of the ministry's screens (AppBackground JSON; NULL = the default). */
  pageBackground: text('page_background', { mode: 'json' }).$type<AppBackground>(),
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
    /** Doesn't pay monthly dues (not shown as owing on the dues sheet). */
    duesExempt: integer('dues_exempt', { mode: 'boolean' }).notNull().default(false),
    /** Position (and so the rights) inside the environment. */
    positionId: integer('position_id'),
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
    location: text('location'),
    topic: text('topic'),
    /** MEETING_KINDS: prayer, worship, outside, guest, prophetic. */
    kind: text('kind'),
    /** Who leads this meeting (assigned ahead, gets a bot message). */
    leaderUserId: integer('leader_user_id').references(() => users.id),
    /** Who buys food / spends the budget. */
    snackUserId: integer('snack_user_id').references(() => users.id),
    budgetCents: integer('budget_cents'),
    /** When the leader / snack person was last sent a message about this meeting. */
    leaderNotifiedAt: text('leader_notified_at'),
    snackNotifiedAt: text('snack_notified_at'),
    /** Who sent the message (told when the person agrees or can't). */
    leaderNotifiedBy: integer('leader_notified_by'),
    snackNotifiedBy: integer('snack_notified_by'),
    /** When the person pressed "Agree" in the bot message. */
    leaderAcceptedAt: text('leader_accepted_at'),
    snackAcceptedAt: text('snack_accepted_at'),
    /** Who last told people about the meeting, and when (they hear the answers). */
    announcedBy: integer('announced_by'),
    announcedAt: text('announced_at'),
    /** The message asked "Will you come?" (answers in meeting_rsvps). */
    askRsvp: integer('ask_rsvp', { mode: 'boolean' }).notNull().default(false),
    /** The schedule slot it was made for; stays put when the meeting is moved. */
    slotAt: text('slot_at'),
    /** Poster look (PostDesign JSON): colours, fonts, pattern, photo. */
    design: text('design'),
    /** A design template the poster follows (like events). */
    templateId: integer('template_id'),
    /** Up to four speakers shown on the poster: JSON [{name, role, mediaId}]. */
    speakers: text('speakers'),
    /** Meetings made together by "repeats" share this id; repeatRule says how often. */
    seriesId: text('series_id'),
    repeatRule: text('repeat_rule'),
    /** When the "it's live" message went out (null = not yet). */
    liveNotifiedAt: text('live_notified_at'),
    /** When the reminder before the meeting went out (null = not yet). */
    remindedAt: text('reminded_at'),
    rollTakenBy: integer('roll_taken_by'),
    rollTakenAt: text('roll_taken_at'),
    /** Who last said "Can't" to leading / the snacks (the job was freed; shown with a red ✗). */
    leaderDeclinedBy: integer('leader_declined_by'),
    /** Look of the people cards: JSON {color, photoMediaId} (null = the ministry's). */
    peopleLook: text('people_look'),
    snackDeclinedBy: integer('snack_declined_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('meetings_group_starts').on(t.groupId, t.startsAt),
    // Makes schedule → meeting generation idempotent, even after a meeting is moved.
    uniqueIndex('meetings_schedule_slot').on(t.scheduleId, t.slotAt),
    check('meetings_status', sql`${t.status} IN ('scheduled', 'done', 'cancelled')`),
  ],
);

/**
 * Who a meeting is for, when it isn't for the whole ministry. No rows = everyone.
 * Only these people see the meeting and are on its roll call.
 */
/** Answers to "Will you come?" on a meeting message. */
export const meetingRsvps = sqliteTable(
  'meeting_rsvps',
  {
    meetingId: integer('meeting_id')
      .notNull()
      .references(() => meetings.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['going', 'not_going'] }).notNull(),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.userId] })],
);

/** More people with a job at a meeting (music, welcome, tech…), each asked like the leader. */
export const meetingHelpers = sqliteTable(
  'meeting_helpers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetingId: integer('meeting_id')
      .notNull()
      .references(() => meetings.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** What they do, e.g. "Worship", "Welcome". */
    role: text('role').notNull(),
    /** The service's icon (an emoji); speakers default to 🎤. */
    icon: text('icon'),
    /** Speakers are listed first and can go on the poster. */
    speaker: integer('speaker', { mode: 'boolean' }).notNull().default(false),
    notifiedAt: text('notified_at'),
    notifiedBy: integer('notified_by'),
    acceptedAt: text('accepted_at'),
    declinedAt: text('declined_at'),
    createdAt: createdAt(),
  },
  (t) => [index('meeting_helpers_meeting').on(t.meetingId)],
);

export const meetingAudience = sqliteTable(
  'meeting_audience',
  {
    meetingId: integer('meeting_id')
      .notNull()
      .references(() => meetings.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.meetingId, t.userId] }),
    index('meeting_audience_user').on(t.userId),
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

export const announcements = sqliteTable(
  'announcements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    authorId: integer('author_id').references(() => users.id),
    /** Poster headline (optional). */
    title: text('title'),
    text: text('text').notNull(),
    /** JSON array of media ids: the poster's photos, in order. */
    mediaIds: text('media_ids', { mode: 'json' }).$type<number[]>(),
    /** Colour laid over the photos so the headline stays readable. */
    tintColor: text('tint_color'),
    tintStrength: real('tint_strength'),
    /** Design template used as the poster background when there are no photos. */
    templateId: integer('template_id'),
    recipients: integer('recipients').notNull().default(0),
    /** Pinned posts come first in the ministry's feed. */
    pinnedAt: text('pinned_at'),
    /** The post's poster picture (rendered on the phone), sent with the bot message. */
    posterMediaId: integer('poster_media_id').references(() => media.id),
    /** The event this post announces (written when the event was created). */
    eventId: integer('event_id'),
    editedAt: text('edited_at'),
    /** PostDesign JSON: cover, type, colour, fonts; NULL = defaults. */
    design: text('design'),
    /** PostBlock[] JSON: pictures, tables, files, polls, quizzes after the text. */
    blocks: text('blocks'),
    deletedAt: text('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('announcements_group_created').on(t.groupId, t.createdAt)],
);

/**
 * Uploaded images (receipts, event photos), resized in the browser. Stored in D1 so the
 * app stays on the free plan without a payment card; served through signed URLs.
 */
export const media = sqliteTable(
  'media',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id').references(() => groups.id),
    kind: text('kind', { enum: ['receipt', 'event'] }).notNull(),
    mime: text('mime').notNull(),
    data: text('data').notNull(),
    bytes: integer('bytes').notNull(),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('media_group').on(t.groupId)],
);

export const TRANSACTION_KINDS = [
  'income',
  'expense',
  'donation',
  'dues',
  'event_payment',
  'event_expense',
] as const;

/**
 * Group cash book. Amounts are positive; the kind decides the sign (expenses subtract).
 * Entries are never deleted, only voided, so the history stays auditable.
 */
export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    kind: text('kind', { enum: TRANSACTION_KINDS }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    /** Local calendar date "YYYY-MM-DD" in the church time zone. */
    occurredOn: text('occurred_on').notNull(),
    /** Who paid (dues, donations, event payments). */
    memberUserId: integer('member_user_id').references(() => users.id),
    /** Dues month "YYYY-MM". */
    period: text('period'),
    category: text('category'),
    note: text('note'),
    eventId: integer('event_id'),
    meetingId: integer('meeting_id'),
    receiptMediaId: integer('receipt_media_id').references(() => media.id),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
    voidedAt: text('voided_at'),
    voidedBy: integer('voided_by'),
  },
  (t) => [
    index('transactions_group_date').on(t.groupId, t.occurredOn),
    index('transactions_member').on(t.memberUserId),
    index('transactions_event').on(t.eventId),
    index('transactions_meeting').on(t.meetingId),
    check('transactions_amount', sql`${t.amountCents} > 0`),
    check(
      'transactions_kind',
      sql`${t.kind} IN ('income', 'expense', 'donation', 'dues', 'event_payment', 'event_expense')`,
    ),
  ],
);

export type Transaction = typeof transactions.$inferSelect;

/**
 * One-off happenings (camp, trip, concert). Every section beyond title and time is
 * optional and switched on per event: gallery, RSVP, duty roles, cost tracking.
 */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at'),
    location: text('location'),
    coverMediaId: integer('cover_media_id').references(() => media.id),
    /** The designed cover drawn as a picture (sent by the bot when there is no cover photo). */
    posterMediaId: integer('poster_media_id').references(() => media.id),
    hasGallery: integer('has_gallery', { mode: 'boolean' }).notNull().default(false),
    hasRsvp: integer('has_rsvp', { mode: 'boolean' }).notNull().default(false),
    hasDuties: integer('has_duties', { mode: 'boolean' }).notNull().default(false),
    hasCost: integer('has_cost', { mode: 'boolean' }).notNull().default(false),
    /** Per person, when the event costs money. */
    priceCents: integer('price_cents'),
    /** Link to a Telegram chat for this event (t.me/…). */
    chatUrl: text('chat_url'),
    /** Pinned to the top of the main page, for the whole church. */
    pinnedAt: text('pinned_at'),
    /** Cover design (PostDesign JSON) when there is no cover photo, like posts. */
    design: text('design'),
    /** Show a "🔥 N days left" countdown on the ministry home. */
    countdown: integer('countdown', { mode: 'boolean' }).notNull().default(false),
    /** When the automatic reminder went out (null = not yet). */
    remindedAt: text('reminded_at'),
    /** When the "it's live" message went out (null = not yet). */
    liveNotifiedAt: text('live_notified_at'),
    /** Up to four speakers shown on the poster: JSON [{name, role, mediaId}]. */
    speakers: text('speakers'),
    /** A Telegram chat of its own, managed by the bot (see lib/eventChats). */
    tgChatId: integer('tg_chat_id'),
    tgChatTitle: text('tg_chat_title'),
    chatLinkCode: text('chat_link_code'),
    templateId: integer('template_id'),
    status: text('status', { enum: ['scheduled', 'cancelled'] })
      .notNull()
      .default('scheduled'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('events_group_starts').on(t.groupId, t.startsAt),
    check('events_status', sql`${t.status} IN ('scheduled', 'cancelled')`),
  ],
);

export const eventPhotos = sqliteTable(
  'event_photos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id),
    mediaId: integer('media_id')
      .notNull()
      .references(() => media.id),
    createdAt: createdAt(),
  },
  (t) => [index('event_photos_event').on(t.eventId)],
);

export const eventRsvps = sqliteTable(
  'event_rsvps',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['going', 'not_going'] }).notNull(),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    check('event_rsvps_status', sql`${t.status} IN ('going', 'not_going')`),
  ],
);

/** Duties for an event ("Worship", "Food", "Photos"), each with people assigned. */
export const eventRoles = sqliteTable(
  'event_roles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    /** What this duty involves, shown to the people who serve in it. */
    description: text('description'),
    /** Who leads this duty (one of its people). */
    leaderUserId: integer('leader_user_id').references(() => users.id),
    slots: integer('slots').notNull().default(1),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('event_roles_event').on(t.eventId)],
);

export const eventRoleAssignees = sqliteTable(
  'event_role_assignees',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => eventRoles.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.userId] }),
    index('event_role_assignees_user').on(t.userId),
  ],
);

export type EventRow = typeof events.$inferSelect;

/** Positions inside an environment ("Лидер", "Казначей"…), each with a set of rights. */
export const positions = sqliteTable(
  'positions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    name: text('name').notNull(),
    description: text('description'),
    /** JSON array of Permission keys. */
    permissions: text('permissions', { mode: 'json' }).$type<string[]>().notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    /** LabelLook JSON: the position's chip looks like a label (null = plain chip). */
    look: text('look', { mode: 'json' }).$type<LabelLook>(),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('positions_group').on(t.groupId)],
);

export type Position = typeof positions.$inferSelect;

/** Reactions to an announcement in a ministry's feed (one per person per emoji). */
export const announcementReactions = sqliteTable(
  'announcement_reactions',
  {
    announcementId: integer('announcement_id')
      .notNull()
      .references(() => announcements.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId, t.emoji] })],
);

/** Comments under an announcement: the ministry's small in-app chat. */
export const announcementComments = sqliteTable(
  'announcement_comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    announcementId: integer('announcement_id')
      .notNull()
      .references(() => announcements.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    text: text('text').notNull(),
    createdAt: createdAt(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('announcement_comments_post').on(t.announcementId, t.id)],
);

/** Reusable looks (colours, pattern, text colour) for ministries and posters. */
export const designTemplates = sqliteTable('design_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  brandColor: text('brand_color'),
  pattern: text('pattern'),
  textColor: text('text_color').notNull().default('auto'),
  /** Logo shown in the pattern when it uses the logo (media id). */
  logoMediaId: integer('logo_media_id'),
  /** Photo background (BackdropConfig JSON). */
  backdrop: text('backdrop'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: createdAt(),
});

/** What each person has already seen in a ministry's feed (for the unread counters). */
export const feedReads = sqliteTable(
  'feed_reads',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    lastPostId: integer('last_post_id').notNull().default(0),
    lastCommentId: integer('last_comment_id').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

/** The last comment each person has seen under a post (its own unread counter). */
export const postReads = sqliteTable(
  'post_reads',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    announcementId: integer('announcement_id')
      .notNull()
      .references(() => announcements.id),
    lastCommentId: integer('last_comment_id').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.announcementId] })],
);

/** Answers to polls and quizzes inside posts (one row per chosen option). */
export const pollVotes = sqliteTable(
  'poll_votes',
  {
    announcementId: integer('announcement_id')
      .notNull()
      .references(() => announcements.id),
    blockId: text('block_id').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    option: integer('option').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.blockId, t.userId, t.option] })],
);

/**
 * Documents attached to posts (PDF, office files, screenshots). Stored in D1 as raw
 * bytes split into parts under the 2 MB row limit, so no payment card is needed.
 */
export const files = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  parts: integer('parts').notNull(),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const fileParts = sqliteTable(
  'file_parts',
  {
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id),
    idx: integer('idx').notNull(),
    data: bytesColumn('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.idx] })],
);

/** Leaders' notes on calendar days, each with a colour (only leaders see them). */
export const calendarNotes = sqliteTable(
  'calendar_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    /** Local date "YYYY-MM-DD". */
    date: text('date').notNull(),
    text: text('text').notNull(),
    color: text('color').notNull(),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('calendar_notes_group_date').on(t.groupId, t.date)],
);

/**
 * Saved wording for the message to a meeting's leader or snack person. The text keeps
 * placeholders ({title} {group} {date} {budget} {name} {notes}) that are filled in per meeting.
 */
export const messageTemplates = sqliteTable(
  'message_templates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    role: text('role', { enum: ['leader', 'snack'] }).notNull(),
    name: text('name').notNull(),
    text: text('text').notNull(),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('message_templates_group').on(t.groupId, t.role)],
);

/** The in-app chat of an event (a thread for the people taking part). */
export const eventMessages = sqliteTable(
  'event_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    text: text('text').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('event_messages_event').on(t.eventId, t.id)],
);

/** A ministry's own labels for people ("Worship team", "New"), each with a colour and an animation. */
export const groupLabels = sqliteTable(
  'group_labels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    name: text('name').notNull(),
    color: text('color').notNull(),
    /** Second colour of a gradient label. */
    color2: text('color2'),
    /** solid | gradient | rainbow */
    style: text('style').notNull().default('solid'),
    animation: text('animation').notNull().default('none'),
    /** LabelExtra JSON: more colours, texture, font, emoji, styled name. */
    look: text('look', { mode: 'json' }).$type<Partial<LabelExtra>>(),
    sort: integer('sort').notNull().default(0),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('group_labels_group').on(t.groupId)],
);

export const memberLabels = sqliteTable(
  'member_labels',
  {
    labelId: integer('label_id')
      .notNull()
      .references(() => groupLabels.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.labelId, t.userId] }), index('member_labels_user').on(t.userId)],
);

/** What a person was told (reminders, duties, jobs, repeated posts), kept to read in the app. */
export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** JSON {type:'event'|'task'|'post', ...ids} for the page it opens. */
    link: text('link'),
    createdAt: createdAt(),
    readAt: text('read_at'),
  },
  (t) => [index('notifications_user').on(t.userId, t.id)],
);

/** The programme of an event: timed items, each with who leads it. */
export const eventProgram = sqliteTable(
  'event_program',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id),
    /** Day of the event (0 = the first day). */
    day: integer('day').notNull().default(0),
    /** Local "HH:MM". */
    time: text('time').notNull(),
    title: text('title').notNull(),
    userId: integer('user_id').references(() => users.id),
    note: text('note'),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('event_program_event').on(t.eventId)],
);
