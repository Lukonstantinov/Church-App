import { labelLookSchema, type LabelLook } from './labels';
import { appBackgroundSchema, type AppBackground } from './background';
import type { ScreenLook } from './screenLook';
import { z } from 'zod';
import {
  ENTER_ANIMATIONS,
  isBrandValue,
  isTextColor,
  patternSchema,
  backdropSchema,
  type BackdropConfig,
  type BrandValue,
  type EnterAnimation,
  type PatternConfig,
} from './brand';
import type { Permission } from './permissions';
import {
  MEETING_MOTIONS,
  motionTunesSchema,
  type MeetingMotion,
  type MotionTunes,
} from './motions';
import type { PosterTemplate } from './posterTemplates';
import { chatUrlSchema, type EventSummary } from './events';
import {
  postBlocksSchema,
  postDesignSchema,
  speakerLookSchema,
  speakersSchema,
  type PostBlockView,
  type PostDesign,
  type Speaker,
  type SpeakerLook,
} from './posts';
import { LOCALES, type Locale } from './i18n/locales';

/** Roles within a single group. Church-wide admin is a separate flag on the user. */
export const groupRoleSchema = z.enum(['leader', 'member']);
export type GroupRole = z.infer<typeof groupRoleSchema>;

export const membershipStatusSchema = z.enum(['pending', 'active', 'left', 'rejected']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export interface MeMembership {
  groupId: number;
  groupName: string;
  /** Rights from the member's position (empty for plain members). */
  permissions: Permission[];
  positionName: string | null;
  /** Environment theme and logo. */
  brandColor: string | null;
  logoUrl: string | null;
  /** Group's Telegram chat (active members only). */
  chatUrl?: string | null;
  role: GroupRole;
  status: MembershipStatus;
}

export interface ChurchInfo {
  name: string;
  /** IANA zone, e.g. "Europe/Riga". Schedules and all displayed times use it. */
  timezone: string;
  currency: string;
  /** Language for people who haven't picked one. */
  defaultLocale: Locale;
  brandColor: BrandValue;
  /** Relative URL of the uploaded logo (cache-busted), or null. */
  logoUrl: string | null;
  /** What is printed top right on event posters and PDFs; empty = the church's name. */
  sheetLabel: string | null;
  /** The main window's background (null = the default). */
  appBackground: AppBackground | null;
  /** How the parts of the main page look and move (set in the Design studio). */
  screenLook: ScreenLook;
  /** Only people with the designer right may change the look of meetings, events and posts. */
  designLock: boolean;
}

export const updateMeSchema = z.object({ locale: z.enum(LOCALES) });
export type UpdateMeInput = z.input<typeof updateMeSchema>;

export const updateChurchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  defaultLocale: z.enum(LOCALES).optional(),
  brandColor: z.string().refine(isBrandValue, 'theme').optional(),
  sheetLabel: z.string().trim().max(40).nullable().optional(),
  appBackground: appBackgroundSchema.nullable().optional(),
  designLock: z.boolean().optional(),
});
export type UpdateChurchInput = z.input<typeof updateChurchSchema>;

/** Logos are resized in the browser; the server accepts at most this many bytes. */
export const LOGO_MAX_BYTES = 300_000;

export interface MeResponse {
  church: ChurchInfo;
  user: {
    id: number;
    telegramId: number | null;
    firstName: string;
    lastName: string | null;
    username: string | null;
    isAdmin: boolean;
    /** Church admin from the deployment config (ADMIN_TELEGRAM_IDS): sees telemetry. */
    isDeveloper: boolean;
    privacyAccepted: boolean;
    /** Effective UI language (own choice, else church default). */
    locale: Locale;
    /**
     * A developer trying the app as another role ("Дизайнер · Молодежка"): the app works
     * as their test person until they go back. Null otherwise.
     */
    testing: string | null;
  };
  memberships: MeMembership[];
}

/** What a developer can try the app as (lib/testing.ts on the server). */
export const testAsSchema = z.discriminatedUnion('kind', [
  /** A member with this position (and so its rights). */
  z.object({ kind: z.literal('position'), positionId: z.number().int().positive() }),
  /** A member without a position. */
  z.object({ kind: z.literal('member'), groupId: z.number().int().positive() }),
  /** Asked to join, not approved yet. */
  z.object({ kind: z.literal('pending'), groupId: z.number().int().positive() }),
  /** Someone who isn't in any ministry yet. */
  z.object({ kind: z.literal('newcomer') }),
  /** A church admin (everything, but without the developer screens). */
  z.object({ kind: z.literal('admin') }),
]);
export type TestAsInput = z.infer<typeof testAsSchema>;

export interface TestAsOptions {
  /** What is being tried now, or null. */
  current: string | null;
  groups: {
    id: number;
    name: string;
    positions: { id: number; name: string; rights: number }[];
  }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---------- Groups ----------

export interface GroupSummary {
  id: number;
  name: string;
  description: string | null;
  archived: boolean;
  activeCount: number;
  pendingCount: number;
  leaderNames: string[];
  /** Requester's role in this group; null for admins who aren't members. */
  myRole: GroupRole | null;
  /** Requester's rights here (all of them for church admins). */
  myPermissions: Permission[];
  positionName: string | null;
  brandColor: string | null;
  pattern: PatternConfig | null;
  /** Text on the ministry's coloured blocks. */
  textColor: string;
  animation: EnterAnimation;
  /** Colour of the new-posts counter; null = the theme colour. */
  badgeColor: string | null;
  logoMediaId: number | null;
  /** New posts and new chat messages (comments) since the person last opened the feed. */
  unreadPosts: number;
  unreadComments: number;
  logoUrl: string | null;
  /** Photo behind the card (whole or split with the pattern). */
  backdrop: BackdropConfig | null;
  backdropUrl: string | null;
  /** The background of this ministry's screens (null = the default). */
  pageBackground: AppBackground | null;
  /** How the parts of the ministry's page look and move (set in the Design studio). */
  screenLook: ScreenLook;
  /** Meetings and events going on right now (for the LIVE marks on the main screen). */
  live: LiveItem[];
  /** Starting within the next two hours (earliest first). */
  soon: LiveItem[];
}

export interface LiveItem {
  kind: 'meeting' | 'event';
  id: number;
  title: string;
  startsAt: string;
  endsAt: string | null;
}

export interface GroupDetail extends GroupSummary {
  /** Only present for leaders/admins. */
  inviteLink: string | null;
  canManage: boolean;
  /** The group's Telegram chat, if linked. */
  chatUrl: string | null;
  /** Usual place of the ministry's meetings. */
  defaultLocation: string;
  eventReminderHours: number | null;
  /** Members without rights see their own attendance on the home screen. */
  membersSeeAttendance: boolean;
  /** Minutes before each meeting a reminder goes out (empty = none). */
  meetingReminders: number[];
  /** How lively the ministry's meetings move. */
  meetingMotion: MeetingMotion;
  /** The design template meetings without a look of their own wear (null = the ministry's). */
  meetingTemplateId: number | null;
  /** The design template events without a look of their own wear (null = the ministry's). */
  eventTemplateId: number | null;
  /** How speakers' photos show on its meetings (null = as designed). */
  speakerLook: SpeakerLook | null;
  /** Services saved for meetings (name, icon, speaker). */
  meetingServices: MeetingService[];
  /** Chat managed by the bot (members-only): its title; null when not linked. */
  managedChat: { title: string | null; pending: boolean } | null;
}

const name = z.string().trim().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const createGroupSchema = z.object({
  name,
  description: optionalText(300),
});
export type CreateGroupInput = z.input<typeof createGroupSchema>;

/** Reminder times before a meeting to choose from (minutes), and the usual ones. */
export const REMINDER_MINUTES = [15, 30, 60, 120, 180, 1440] as const;
export const DEFAULT_MEETING_REMINDERS = [120, 60];

export const updateGroupSchema = z.object({
  brandColor: z.string().refine(isBrandValue, 'theme').nullable().optional(),
  pattern: patternSchema.nullable().optional(),
  textColor: z.string().refine(isTextColor, 'text colour').optional(),
  animation: z.enum(ENTER_ANIMATIONS).optional(),
  badgeColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  logoMediaId: z.number().int().positive().nullable().optional(),
  backdrop: backdropSchema.nullable().optional(),
  pageBackground: appBackgroundSchema.nullable().optional(),
  name: name.optional(),
  description: optionalText(300).optional(),
  chatUrl: chatUrlSchema.optional(),
  /** Usual place of the ministry's meetings (empty = none). */
  defaultLocation: z.string().trim().max(120).optional(),
  /** Remind everyone this many hours before an event (null = don't). */
  eventReminderHours: z.number().int().min(1).max(168).nullable().optional(),
  /** Minutes before each meeting a reminder goes (null = 2 h and 1 h, [] = none). */
  meetingReminders: z.array(z.number().int().min(5).max(2880)).max(6).nullable().optional(),
  /** How lively meetings' backgrounds move (null = calm). */
  meetingMotion: z.enum(MEETING_MOTIONS).nullable().optional(),
  /** Members without rights see their own attendance (off by default). */
  membersSeeAttendance: z.boolean().optional(),
});
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

// ---------- Members ----------

export const labelInputSchema = labelLookSchema.extend({
  name: z.string().trim().min(1).max(24),
});
export type LabelInput = z.input<typeof labelInputSchema>;

export interface LabelRef extends LabelLook {
  id: number;
  name: string;
}

/** Which of the ministry's labels a person has. */
export const setMemberLabelsSchema = z.object({
  labelIds: z.array(z.number().int().positive()).max(30),
});
export type SetMemberLabelsInput = z.input<typeof setMemberLabelsSchema>;

export interface MemberRow {
  /** The person's custom labels. */
  labels: LabelRef[];
  membershipId: number;
  positionId: number | null;
  positionName: string | null;
  /** The position's chip look (null = plain). */
  positionLook: LabelLook | null;
  userId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  role: GroupRole;
  status: MembershipStatus;
  joinedAt: string | null;
  requestedAt: string;
  /** No Telegram account linked (added by a leader). */
  offline: boolean;
  isReachable: boolean;
  /** A church administrator (the name is shown in red). */
  isAdmin: boolean;
  guardianConsent: boolean;
  /** Attendance rate over the group's last 8 roll calls; null if none recorded yet. */
  recentPercent: number | null;
  /** Profile photo; null = initials. */
  photoUrl: string | null;
}

/** Someone in the ministry, for the contacts list (tap to write in Telegram). */
export interface ContactRow {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  positionName: string | null;
  positionLook: LabelLook | null;
  /** The position (null = none: counted with the ministry's default one). */
  positionId: number | null;
  /**
   * Where the position stands in the ministry's order (Позиции: top first); the default
   * position and people without one come last.
   */
  positionRank: number;
  offline: boolean;
  /** A church administrator (the name is shown in red). */
  isAdmin: boolean;
  /** Labels everyone in the ministry can see. */
  labels: LabelRef[];
}

export interface MemberDetail {
  user: {
    id: number;
    firstName: string;
    lastName: string | null;
    username: string | null;
    offline: boolean;
    isAdmin: boolean;
    isReachable: boolean;
    guardianConsentAt: string | null;
    hasActiveClaimCode: boolean;
    /** Profile photo (used on meeting cards and speaker posters); null = initials. */
    photoUrl: string | null;
  };
  /** Memberships in groups the requester can see. */
  memberships: (MeMembership & {
    membershipId: number;
    joinedAt: string | null;
    /** The person's custom labels in that ministry. */
    labels: LabelRef[];
    positionLook: LabelLook | null;
  })[];
  /** Attendance in the groups the requester may see (leaders: theirs; the user: own). */
  attendance: MemberAttendance[];
  permissions: {
    canEditProfile: boolean;
    /** The person themselves, or whoever manages them. */
    canEditPhoto: boolean;
    canIssueClaimCode: boolean;
    canSetAdmin: boolean;
  };
}

export const addOfflineMemberSchema = z.object({
  firstName: name,
  lastName: optionalText(64),
  guardianConsent: z.boolean().default(false),
});
export type AddOfflineMemberInput = z.input<typeof addOfflineMemberSchema>;

export const updateMembershipSchema = z
  .object({
    status: z.enum(['active', 'rejected', 'left']).optional(),
    /** Position inside the environment (needs the "positions" right). */
    positionId: z.number().int().positive().optional(),
  })
  .refine((v) => v.status !== undefined || v.positionId !== undefined, 'nothing to update');
export type UpdateMembershipInput = z.input<typeof updateMembershipSchema>;

export const updateUserSchema = z.object({
  firstName: name.optional(),
  lastName: optionalText(64).optional(),
  guardianConsent: z.boolean().optional(),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const setAdminSchema = z.object({ isAdmin: z.boolean() });

export interface ClaimCodeResponse {
  link: string;
  code: string;
  expiresAt: string;
}

// ---------- Attendance ----------

export const attendanceStatusSchema = z.enum(['present', 'late', 'excused', 'absent']);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export type MeetingStatus = 'scheduled' | 'done' | 'cancelled';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const duration = z.number().int().min(15).max(600);

export interface ScheduleRow {
  id: number;
  groupId: number;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  startTime: string;
  durationMin: number;
  title: string;
  active: boolean;
}

export const createScheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: time,
  durationMin: duration.default(120),
  title: name,
});
export type CreateScheduleInput = z.input<typeof createScheduleSchema>;

export const updateScheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6).optional(),
  startTime: time.optional(),
  durationMin: duration.optional(),
  title: name.optional(),
  active: z.boolean().optional(),
});
export type UpdateScheduleInput = z.input<typeof updateScheduleSchema>;

/** Kinds of youth meeting (optional label). */
export const MEETING_KINDS = ['prayer', 'worship', 'outside', 'guest', 'prophetic'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export interface MeetingPerson {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  /** Their photo, when one was added (signed link). */
  photoUrl?: string | null;
}

/** Someone else with a job at a meeting, asked like the leader; their answer shows as a mark. */
export interface MeetingHelper {
  id: number;
  role: string;
  icon: string | null;
  speaker: boolean;
  person: MeetingPerson;
  notifiedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
}

/** Icons to choose for a service at a meeting. */
export const SERVICE_ICONS = [
  '🎤',
  '🎸',
  '🎹',
  '🥁',
  '🙏',
  '🤝',
  '🍕',
  '☕',
  '🎛',
  '💡',
  '📸',
  '🎥',
  '📖',
  '🧒',
  '🧹',
  '🚗',
] as const;

/** A service people do at meetings (saved per ministry for reuse). */
export const meetingServiceSchema = z.object({
  name: z.string().trim().min(1).max(40),
  icon: z.string().trim().min(1).max(8),
  /** Speakers are listed first and can go on the poster. */
  speaker: z.boolean().default(false),
});
export type MeetingService = z.infer<typeof meetingServiceSchema>;
export const meetingServicesSchema = z.object({
  services: z.array(meetingServiceSchema).max(40),
});

export const addHelperSchema = z.object({
  userId: z.number().int().positive(),
  role: z.string().trim().min(1).max(40),
  icon: z.string().trim().min(1).max(8).nullish(),
  speaker: z.boolean().optional(),
});

export const PEOPLE_STYLES = ['dark', 'glass', 'color', 'mixed'] as const;
export type PeopleStyle = (typeof PEOPLE_STYLES)[number];

/** Changes a helper's service name or icon. */
export const updateHelperSchema = z.object({
  role: z.string().trim().min(1).max(40).optional(),
  icon: z.string().trim().min(1).max(8).optional(),
});

/** Send the list of who serves: to everyone the meeting is for, or only to the team. */
export const sendRosterSchema = z.object({ to: z.enum(['everyone', 'team']) });

/** How the people cards look: card colour and the panel's photo (null = the ministry's). */
export const peopleLookSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  photoMediaId: z.number().int().positive().nullable(),
  /**
   * Cards and chips: dark metal, see-through (the ministry's background shows), one
   * colour, or a different tint for each person. Older saves without it: colour if set.
   */
  style: z.enum(PEOPLE_STYLES).optional(),
  /** Icons of the leader and the snack person (others keep their service's icon). */
  /** The ministry's icon pattern over the background, also over a photo (default yes). */
  pattern: z.boolean().optional(),
  leaderIcon: z.string().trim().min(1).max(8).nullish(),
  snackIcon: z.string().trim().min(1).max(8).nullish(),
});
export type PeopleLook = z.infer<typeof peopleLookSchema> & { photoUrl: string | null };
export type AddHelperInput = z.input<typeof addHelperSchema>;

/** A person's photo (an uploaded ministry picture), or null to remove it. */
export const personPhotoSchema = z.object({ mediaId: z.number().int().positive().nullable() });

export interface MeetingRow {
  id: number;
  groupId: number;
  scheduleId: number | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  guestCount: number;
  notes: string | null;
  rollTakenAt: string | null;
  location: string | null;
  topic: string | null;
  kind: MeetingKind | null;
  /** Who leads this meeting. */
  leader: MeetingPerson | null;
  /** Who buys food / spends the meeting budget. */
  snackPerson: MeetingPerson | null;
  budgetCents: number | null;
  /** Who the meeting is for; null = the whole ministry. */
  audience: number[] | null;
  /** When the leader / snack person was last messaged (nothing is sent automatically). */
  leaderNotifiedAt: string | null;
  snackNotifiedAt: string | null;
  /** When they pressed "Agree" in the bot message (null = not yet). */
  leaderAcceptedAt: string | null;
  snackAcceptedAt: string | null;
  /** Who last said "Can't" (the job is free again; shown with a red ✗ until someone else is chosen). */
  leaderDeclined: MeetingPerson | null;
  snackDeclined: MeetingPerson | null;
  /** Card colour and panel photo of the people block (null = the ministry's look). */
  peopleLook: PeopleLook | null;
  /** More people with a job at this meeting (speakers first). */
  helpers: MeetingHelper[];
  /** Counts are filled for meetings that have a saved roll call. */
  counts: Record<AttendanceStatus, number>;
  /** Poster look (colours, fonts, pattern); null = the ministry's own. */
  design: PostDesign | null;
  templateId: number | null;
  /** The poster's resolved look (colours, pattern, photo); filled with the speakers' photo links. */
  look: PosterLook | null;
  /** Up to four speakers shown on the poster and the meeting screen. */
  speakers: Speaker[];
  /** How its background moves (its own choice, else the ministry's). */
  motion: MeetingMotion;
  /** Its own choice only (null = follows the ministry). */
  ownMotion: MeetingMotion | null;
  /** The home tile's animation: its own, else its template's (null = the ministry's tile setting, else `motion`). */
  tileMotion: MeetingMotion | null;
  ownTileMotion: MeetingMotion | null;
  /** The poster's animation: its own, else its template's (null = none). */
  posterMotion: MeetingMotion | null;
  ownPosterMotion: MeetingMotion | null;
  /** Its own choice of template (null = follows the ministry's default, if any). */
  ownTemplateId: number | null;
  /** Goes up with every change of its look (see `lookVersion` in the update). */
  lookVersion: number;
  /** Settings per animation: its own over its template's. */
  motionTunes: MotionTunes;
  ownMotionTunes: MotionTunes;
  /** How speakers' photos show (its own poster design's, else its template's). */
  speakerLook: SpeakerLook | null;
  /** A poster template (Design → Posters) used for its hero, tile and poster (null = none). */
  posterTemplateId: number | null;
  poster: PosterTemplate | null;
  /** Set when the meeting is one of a repeating series. */
  seriesId: string | null;
  repeat: MeetingRepeat | null;
}

/** How often a meeting comes back. */
export const REPEATS = ['weekly', 'biweekly', 'monthly'] as const;
export type RepeatEvery = (typeof REPEATS)[number];
export const repeatSchema = z.object({
  every: z.enum(REPEATS),
  /** How many meetings in all, the first included. */
  count: z.number().int().min(2).max(52),
});
export type MeetingRepeat = z.infer<typeof repeatSchema>;

export const createMeetingSchema = z.object({
  /** Local calendar date in the church time zone. */
  date,
  startTime: time,
  durationMin: duration.default(120),
  title: name,
  /** Only these people (user ids); omitted or empty = everyone in the ministry. */
  audience: z.array(z.number().int().positive()).max(500).optional(),
  kind: z.enum(MEETING_KINDS).nullable().optional(),
  design: postDesignSchema.nullish(),
  templateId: z.number().int().positive().nullish(),
  speakers: speakersSchema.optional(),
  /** The poster's animation (null = the template's, else none). */
  posterMotion: z.enum(MEETING_MOTIONS).nullish(),
  /** Its own screen and tile animations and settings per animation (null = the template's). */
  motion: z.enum(MEETING_MOTIONS).nullish(),
  tileMotion: z.enum(MEETING_MOTIONS).nullish(),
  motionTunes: motionTunesSchema.nullish(),
  posterTemplateId: z.number().int().positive().nullish(),
  /** Make it a repeating meeting: the calendar is filled for all of them. */
  repeat: repeatSchema.nullish(),
});
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object({
  /** The look version the sheet was opened with: refused if someone changed the look since. */
  lookVersion: z.number().int().min(0).optional(),
  status: z.enum(['scheduled', 'cancelled']).optional(),
  title: name.optional(),
  notes: optionalText(500).optional(),
  /** Move the meeting (local date and time in the church time zone). */
  date: date.optional(),
  startTime: time.optional(),
  durationMin: duration.optional(),
  location: optionalText(120).optional(),
  topic: optionalText(200).optional(),
  kind: z.enum(MEETING_KINDS).nullable().optional(),
  design: postDesignSchema.nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  speakers: speakersSchema.optional(),
  peopleLook: peopleLookSchema.nullable().optional(),
  /** This meeting's animation level (null = the ministry's). */
  motion: z.enum(MEETING_MOTIONS).nullable().optional(),
  /** Its home tile's and its poster's own animations (null = the template's / default). */
  tileMotion: z.enum(MEETING_MOTIONS).nullable().optional(),
  posterMotion: z.enum(MEETING_MOTIONS).nullable().optional(),
  /** Its own settings per animation (null = the template's). */
  motionTunes: motionTunesSchema.nullable().optional(),
  posterTemplateId: z.number().int().positive().nullable().optional(),
  /** With a series: apply the change to this and all the later meetings of it. */
  applyToSeries: z.boolean().optional(),
  leaderUserId: z.number().int().positive().nullable().optional(),
  snackUserId: z.number().int().positive().nullable().optional(),
  budgetCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  /** null = everyone again. */
  audience: z.array(z.number().int().positive()).max(500).nullable().optional(),
});
export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

/** A meeting opened on its own: what everyone sees, plus attendance and money for those allowed. */
/** A designer's prepared announcement / reminder waiting for someone who may publish it. */
export interface PublishRequestRow {
  id: number;
  requestedBy: string;
  /** The viewer prepared it. */
  mine: boolean;
  createdAt: string;
  text: string | null;
  posterUrl: string | null;
}

export interface MeetingDetail extends MeetingRow {
  groupName: string;
  /** May send the announcement to everyone (meeting managers and publishers). */
  canPublish: boolean;
  /** May prepare it and send a test to themselves (designers and publishers). */
  canPrepare: boolean;
  /** The pending prepared announcement, for the approvers and its designer. */
  publishRequest: PublishRequestRow | null;
  /** May change the meeting (managers, or its leader for place/topic/snacks). */
  canEdit: boolean;
  /** May change everything incl. leader and time. */
  canManage: boolean;
  /** May change the poster, template and animation (designers; others unless the look is locked). */
  canDesign: boolean;
  /** Attendance (names) for people who take the roll; null otherwise. */
  attendance:
    { userId: number; firstName: string; lastName: string | null; present: boolean }[] | null;
  /** Expenses linked to this meeting, for people who see the money; null otherwise. */
  expenses:
    | {
        id: number;
        amountCents: number;
        note: string | null;
        category: string | null;
        occurredOn: string;
        member: { id: number; firstName: string; lastName: string | null } | null;
      }[]
    | null;
  /** Default budget per meeting in this ministry (cents). */
  defaultBudgetCents: number;
  /** Usual place of this ministry's meetings, prefilled for the leader. */
  defaultLocation: string;
  /** Which job the viewer was given on this meeting (null = none), and if they agreed. */
  myRole: 'leader' | 'snack' | null;
  myAcceptedAt: string | null;
  /** When people were last told about it (null = never). */
  announcedAt: string | null;
  /** "Will you come?" answers (asked = the message asked it). */
  rsvp: {
    asked: boolean;
    mine: MeetingRsvpStatus | null;
    going: MeetingPerson[];
    notGoing: MeetingPerson[];
  };
}

export type MeetingRsvpStatus = 'going' | 'not_going';
export const meetingRsvpSchema = z.object({ status: z.enum(['going', 'not_going']) });

/** Send a post's notification again: to everyone in the ministry, or only chosen people. */
export const resendPostSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(500).nullish(),
  /** The text as edited by the sender (replaces the post's text in this message). */
  text: z.string().trim().min(1).max(3000).nullish(),
  /** With the post's picture (default yes). */
  poster: z.boolean().optional(),
});
export type ResendPostInput = z.input<typeof resendPostSchema>;

/** Send an event reminder now: the text (edited or default) to everyone or chosen people. */
export const remindEventSchema = z.object({
  text: z.string().trim().min(1).max(3000).optional(),
  /** Only these people (user ids); omitted or null = everyone in the ministry. */
  userIds: z.array(z.number().int().positive()).max(500).nullish(),
  /** Add who serves where (every duty with its people). */
  roster: z.boolean().optional(),
  /** Send it with the event's poster (default: yes, when it has one). */
  poster: z.boolean().optional(),
});
export type RemindEventInput = z.input<typeof remindEventSchema>;

/** Placeholders a saved message wording may contain; each is filled in per meeting. */
export const MESSAGE_PLACEHOLDERS = ['title', 'group', 'date', 'budget', 'name', 'notes'] as const;

export const messageTemplateSchema = z.object({
  role: z.enum(['leader', 'snack']),
  name: z.string().trim().min(1).max(60),
  /** The message as shown to the sender; the server turns the meeting's own values back into placeholders. */
  text: z.string().trim().min(1).max(3000),
});
export type MessageTemplateInput = z.input<typeof messageTemplateSchema>;

export interface MessageTemplateRow {
  id: number;
  role: 'leader' | 'snack';
  name: string;
  /** With placeholders, e.g. "{name}, you lead «{title}» on {date}". */
  text: string;
  canDelete: boolean;
}

/** "Agree" / "Can't" for a meeting job, from the app (the bot buttons do the same). */
export const answerMeetingSchema = z.object({
  role: z.enum(['leader', 'snack']),
  agree: z.boolean(),
});
export type AnswerMeetingInput = z.input<typeof answerMeetingSchema>;

/** A meeting the person was given a job on, with what is still to be filled in. */
export interface AssignmentRow {
  meetingId: number;
  groupId: number;
  groupName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  role: 'leader' | 'snack';
  topic: string | null;
  location: string | null;
  kind: MeetingKind | null;
  leader: MeetingPerson | null;
  snackPerson: MeetingPerson | null;
  budgetCents: number;
  notes: string | null;
  /** Pressed "Agree" (or the leader/manager hasn't asked yet and it's just assigned). */
  acceptedAt: string | null;
  /** Things the leader still has to fill in. */
  missing: ('location' | 'topic' | 'snack')[];
}

/** Send the leader or snack person a bot message, with the meeting notes (saved too). */
export const notifyMeetingSchema = z.object({
  role: z.enum(['leader', 'snack']),
  notes: optionalText(500).optional(),
  /** The message as edited by the sender (plain text); omitted = the default text. */
  text: z.string().trim().min(1).max(3000).optional(),
  /** A poster image (uploaded media) sent with the message. */
  posterMediaId: z.number().int().positive().nullish(),
});

/** Colours for calendar notes (iPhone-calendar style). */
export const NOTE_COLORS = [
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#6366f1',
  '#d946ef',
  '#64748b',
] as const;

export const calendarNoteSchema = z.object({
  date,
  text: z.string().trim().min(1).max(300),
  color: z.enum(NOTE_COLORS),
});
export type CalendarNoteInput = z.input<typeof calendarNoteSchema>;

export interface CalendarNote {
  id: number;
  date: string;
  text: string;
  color: string;
}

/** The ministry calendar: coming meetings the person may see, events, and (for leaders) notes. */
export interface CalendarData {
  meetings: MeetingRow[];
  events: EventSummary[];
  /** null when the person can't see leaders' notes. */
  notes: CalendarNote[] | null;
  canNote: boolean;
}
export type NotifyMeetingInput = z.input<typeof notifyMeetingSchema>;

/** Tell the ministry (everyone, leaders or chosen people) about a meeting, with its poster. */
/** What a meeting message is about: the meeting, a changed time, or that it's cancelled. */
export const MEETING_NOTICES = ['announce', 'changed', 'cancelled'] as const;
export type MeetingNotice = (typeof MEETING_NOTICES)[number];

export const announceMeetingSchema = z.object({
  notice: z.enum(MEETING_NOTICES).default('announce'),
  /** Add "I'll come / Can't" buttons; the answers go to the sender. */
  ask: z.boolean().optional(),
  /** For a changed time: when it was before (shown in the default text). */
  previousStartsAt: z.string().datetime().nullish(),
  /** The message as edited by the sender; omitted = the default (in each person's language). */
  text: z.string().trim().min(1).max(3000).optional(),
  /** Only these people; omitted or null = everyone the meeting is for. */
  userIds: z.array(z.number().int().positive()).max(500).nullish(),
  posterMediaId: z.number().int().positive().nullish(),
});
export type AnnounceMeetingInput = z.input<typeof announceMeetingSchema>;

export interface RollEntry {
  userId: number;
  firstName: string;
  lastName: string | null;
  offline: boolean;
  /** null = not marked yet in this roll call. */
  status: AttendanceStatus | null;
  /** Statuses at the last few earlier meetings, oldest → newest (null = no record). */
  recent: (AttendanceStatus | null)[];
}

export interface RollResponse {
  meeting: MeetingRow;
  roster: RollEntry[];
  /** False when the edit window (14 days after the meeting) has passed. */
  editable: boolean;
  editableUntil: string | null;
}

export const saveRollSchema = z.object({
  entries: z
    .array(z.object({ userId: z.number().int().positive(), status: attendanceStatusSchema }))
    .max(1000),
  guestCount: z.number().int().min(0).max(999).default(0),
});
export type SaveRollInput = z.input<typeof saveRollSchema>;

export interface AttendancePoint {
  meetingId: number;
  startsAt: string;
  title: string;
  attended: number;
  total: number;
}

export interface GroupStats {
  activeMembers: number;
  pendingCount: number;
  /** Average attendance rate (0–100) over the recent meetings in `series`; null if none. */
  averageRate: number | null;
  /** Oldest → newest, up to the last 8 meetings with a roll call. */
  series: AttendancePoint[];
  nextMeeting: MeetingRow | null;
  /** Meetings that already ended but have no roll call yet. */
  awaitingRoll: MeetingRow[];
}

export interface RecentMark {
  meetingId: number;
  startsAt: string;
  status: AttendanceStatus;
}

export interface MemberAttendance {
  groupId: number;
  groupName: string;
  /** (present + late) ÷ (meetings held since joining, excused excluded); null if none yet. */
  percent: number | null;
  attended: number;
  counted: number;
  /** Consecutive most-recent absences (excused meetings are skipped). */
  streak: number;
  /** Newest first, up to 8. */
  recent: RecentMark[];
  /**
   * Whether the home screen shows this attendance: to people with rights always, to plain
   * members only when the ministry allows it (`membersSeeAttendance`).
   */
  visible: boolean;
  nextMeeting: {
    id: number;
    title: string;
    startsAt: string;
    endsAt: string;
    location: string | null;
    topic: string | null;
    kind: MeetingKind | null;
    leader: MeetingPerson | null;
  } | null;
}

export interface MyAttendanceResponse {
  groups: MemberAttendance[];
}

// ---------- Announcements ----------

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, '#rrggbb');

/** A post in a ministry's feed: text, optionally a headline, photos and a tint (a poster). */
const announcementFields = z.object({
  /** A picture of the post's cover, made on the phone, sent with the bot message. */
  posterMediaId: z.number().int().positive().nullish(),
  /** The event this post announces. */
  eventId: z.number().int().positive().nullish(),
  title: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v ? v : null)),
  text: z.string().trim().max(4000).default(''),
  mediaIds: z.array(z.number().int().positive()).max(10).default([]),
  tintColor: hexColor.nullish(),
  tintStrength: z.number().min(0).max(0.9).nullish(),
  templateId: z.number().int().positive().nullish(),
  design: postDesignSchema.nullish(),
  blocks: postBlocksSchema,
});
const hasContent = (p: { title: string | null; text: string; blocks: unknown[] }) =>
  p.text.length > 0 || !!p.title || p.blocks.length > 0;

export const createAnnouncementSchema = announcementFields
  .extend({
    /** Also send it to members in Telegram (default). */
    notify: z.boolean().default(true),
  })
  .refine(hasContent, 'empty');
export type CreateAnnouncementInput = z.input<typeof createAnnouncementSchema>;

/** Editing a post changes its content only; nobody is notified again. */
export const updateAnnouncementSchema = announcementFields.refine(hasContent, 'empty');
export type UpdateAnnouncementInput = z.input<typeof updateAnnouncementSchema>;

export const REACTIONS = ['👍', '❤️', '🙏', '🔥', '😂', '🎉'] as const;
export const reactionSchema = z.object({ emoji: z.enum(REACTIONS) });
export const pinSchema = z.object({ pinned: z.boolean() });
export const commentSchema = z.object({ text: z.string().trim().min(1).max(1000) });

export interface PosterLook {
  brandColor: string | null;
  pattern: PatternConfig | null;
  textColor: string;
  logoUrl: string | null;
  backdrop?: BackdropConfig | null;
  backdropUrl?: string | null;
}

export interface AnnouncementRow {
  id: number;
  groupId: number;
  groupName: string;
  title: string | null;
  text: string;
  createdAt: string;
  author: { id: number; firstName: string; lastName: string | null } | null;
  /** How many members the bot sent it to. */
  recipients: number;
  photos: { id: number; url: string }[];
  /** The cover drawn as a picture (what the bot sends); null = none made. */
  posterUrl: string | null;
  tint: { color: string; strength: number } | null;
  templateId: number | null;
  eventId: number | null;
  /** Cover, type, fonts and colour choices (null = defaults). */
  design: PostDesign | null;
  /** Content after the text: pictures, tables, files, polls, quizzes. */
  blocks: PostBlockView[];
  /** Background for posters without photos (a template or the ministry's own look). */
  look: PosterLook | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
  commentCount: number;
  /** Comments by others the viewer hasn't seen yet under this post. */
  unreadComments: number;
  pinned: boolean;
  /** Set when the post was changed after publishing. */
  editedAt: string | null;
  canPin: boolean;
  canEdit: boolean;
  /** May change the post's look (designers; others unless the look is locked). */
  canDesign: boolean;
  canDelete: boolean;
}

export interface CommentRow {
  id: number;
  text: string;
  createdAt: string;
  author: { id: number; firstName: string; lastName: string | null };
  mine: boolean;
  canDelete: boolean;
}

// ---------- Design templates ----------

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  brandColor: z.string().refine(isBrandValue, 'theme').nullable(),
  pattern: patternSchema.nullable(),
  textColor: z.string().refine(isTextColor, 'text colour').default('auto'),
  logoMediaId: z.number().int().positive().nullish(),
  backdrop: backdropSchema.nullish(),
  /** The living wallpaper meetings with this template get (null = the ministry's). */
  motion: z.enum(MEETING_MOTIONS).nullish(),
  /** The home tile's own animation (null = as on the meeting screen). */
  tileMotion: z.enum(MEETING_MOTIONS).nullish(),
  /** The poster's animation (null = none; the sent picture keeps one still frame of it). */
  posterMotion: z.enum(MEETING_MOTIONS).nullish(),
  /** Settings per animation. */
  motionTunes: motionTunesSchema.nullish(),
  /** How speakers' photos show on posters and meeting cards. */
  speakerLook: speakerLookSchema.nullish(),
});
export type TemplateInput = z.input<typeof templateInputSchema>;

export interface DesignTemplate {
  id: number;
  name: string;
  brandColor: string | null;
  pattern: PatternConfig | null;
  textColor: string;
  logoUrl: string | null;
  backdrop: BackdropConfig | null;
  backdropUrl: string | null;
  motion: MeetingMotion | null;
  tileMotion: MeetingMotion | null;
  posterMotion: MeetingMotion | null;
  motionTunes: MotionTunes;
  speakerLook: SpeakerLook | null;
  mine: boolean;
}

export interface AnnouncementResult {
  announcement: AnnouncementRow;
  /** Members without a Telegram account (can't receive it). */
  noTelegram: number;
  /** Members who blocked the bot. */
  unreachable: number;
}

export interface AttendanceExport {
  year: number;
  from: string;
  to: string;
  label?: string;
  groupName: string;
  meetings: { id: number; startsAt: string; title: string; guestCount: number }[];
  rows: {
    member: { id: number; firstName: string; lastName: string | null };
    /** Same order as `meetings`; null = no mark (not a member yet, or not recorded). */
    statuses: (AttendanceStatus | null)[];
  }[];
}

/** Someone from the church directory who could be added to an environment. */
export interface PersonSearchRow {
  userId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  offline: boolean;
  /** Already an active or pending member of this environment. */
  inGroup: boolean;
}

export const addExistingMemberSchema = z.object({
  userId: z.number().int().positive(),
  positionId: z.number().int().positive().optional(),
});
export type AddExistingMemberInput = z.input<typeof addExistingMemberSchema>;

// ---------- Developer telemetry ----------

/** An error the app hit on a phone, sent so the developer can see what broke. */
export const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(3000).nullish(),
  place: z.string().max(200).nullish(),
  userAgent: z.string().max(300).nullish(),
});
export type ClientErrorInput = z.input<typeof clientErrorSchema>;

export interface Telemetry {
  environment: string;
  generatedAt: string;
  database: { sizeBytes: number | null; limitBytes: number };
  tables: { name: string; rows: number }[];
  media: { kind: string; count: number; bytes: number }[];
  users: {
    total: number;
    withTelegram: number;
    active1d: number;
    active7d: number;
    active30d: number;
    blockedBot: number;
  };
  ministries: { total: number; archived: number };
  bot: {
    pending: number;
    sent24h: number;
    dead: number;
    recentErrors: { method: string; error: string | null; at: string }[];
  };
  jobs: { job: string; lastRun: string }[];
  /** The latest errors the app hit on people's phones. */
  clientErrors: { message: string; place: string | null; device: string | null; at: string }[];
  /** Cloudflare free-plan limits this app is designed around. */
  limits: { key: string; value: string }[];
}

// ---------- Notifications inbox ----------

/**
 * Who a moving poster goes to: the sender only, chosen people of the ministry, the whole
 * ministry, everyone in the church (church admins), or those serving at the event/meeting.
 */
export const POSTER_AUDIENCES = ['me', 'people', 'group', 'church', 'serving'] as const;
export type PosterAudience = (typeof POSTER_AUDIENCES)[number];

export type NotificationKind =
  | 'event_reminder'
  | 'event_duty'
  | 'meeting_job'
  | 'meeting_announce'
  | 'meeting_rsvp'
  | 'post_repeat'
  | 'publish_request';

export type NotificationLink =
  | { type: 'event'; eventId: number }
  | { type: 'task'; meetingId: number }
  | { type: 'post'; groupId: number; postId: number };

export interface NotificationRow {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  link: NotificationLink | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationsResponse {
  items: NotificationRow[];
  unread: number;
}

export const readNotificationsSchema = z.object({
  /** Omit to mark everything read. */
  ids: z.array(z.number().int().positive()).max(200).optional(),
});
export type ReadNotificationsInput = z.input<typeof readNotificationsSchema>;

/** One person in the statistics of a period. */
export interface StatPerson {
  userId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  positionName: string | null;
  role: GroupRole | null;
  isAdmin: boolean;
  /** Still in the ministry (false = left, but was marked in the period). */
  active: boolean;
  joinedAt: string | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** present + late + absent (excused not counted). */
  counted: number;
  percent: number | null;
  /** Absences in a row up to the latest meeting of the period. */
  streak: number;
  /** Last meeting they came to (in the period). */
  lastSeen: string | null;
  /** Meetings they led / brought the snacks to. */
  led: number;
  snacks: number;
  /** Event duties they had. */
  duties: number;
}

export interface StatMeeting {
  id: number;
  title: string;
  startsAt: string;
  kind: string | null;
  topic: string | null;
  leaderName: string | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  guests: number;
  rate: number | null;
}

export interface StatEvent {
  id: number;
  title: string;
  startsAt: string;
  going: number;
  notGoing: number;
  roles: number;
  slots: number;
  filled: number;
}

/** Everything the statistics screen shows for one ministry and period. */
export interface GroupStatistics {
  groupName: string;
  from: string;
  to: string;
  summary: {
    activeMembers: number;
    newMembers: number;
    leftMembers: number;
    meetingsHeld: number;
    meetingsCancelled: number;
    averageRate: number | null;
    /** People (members + guests) per meeting on average. */
    averagePeople: number | null;
    guests: number;
    late: number;
    excused: number;
    events: number;
    dutySlots: number;
    dutiesFilled: number;
    /** Members at 80 % or more. */
    faithful: number;
    /** Members absent 3+ times in a row. */
    atRisk: number;
  };
  /** Oldest → newest. */
  series: AttendancePoint[];
  kinds: { kind: string | null; meetings: number; averageRate: number | null }[];
  people: StatPerson[];
  meetings: StatMeeting[];
  events: StatEvent[];
}
