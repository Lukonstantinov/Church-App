import { z } from 'zod';

/** Roles within a single group. Church-wide admin is a separate flag on the user. */
export const groupRoleSchema = z.enum(['leader', 'member']);
export type GroupRole = z.infer<typeof groupRoleSchema>;

export const membershipStatusSchema = z.enum(['pending', 'active', 'left', 'rejected']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export interface MeMembership {
  groupId: number;
  groupName: string;
  role: GroupRole;
  status: MembershipStatus;
}

export interface ChurchInfo {
  name: string;
  /** IANA zone, e.g. "Europe/Riga". Schedules and all displayed times use it. */
  timezone: string;
  currency: string;
}

export interface MeResponse {
  church: ChurchInfo;
  user: {
    id: number;
    telegramId: number | null;
    firstName: string;
    lastName: string | null;
    username: string | null;
    isAdmin: boolean;
    privacyAccepted: boolean;
  };
  memberships: MeMembership[];
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
}

export interface GroupDetail extends GroupSummary {
  /** Only present for leaders/admins. */
  inviteLink: string | null;
  canManage: boolean;
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

export const updateGroupSchema = z.object({
  name: name.optional(),
  description: optionalText(300).optional(),
});
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

// ---------- Members ----------

export interface MemberRow {
  membershipId: number;
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
  guardianConsent: boolean;
  /** Attendance rate over the group's last 8 roll calls; null if none recorded yet. */
  recentPercent: number | null;
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
  };
  /** Memberships in groups the requester can see. */
  memberships: (MeMembership & { membershipId: number; joinedAt: string | null })[];
  /** Attendance in the groups the requester may see (leaders: theirs; the user: own). */
  attendance: MemberAttendance[];
  permissions: {
    canEditProfile: boolean;
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
    role: groupRoleSchema.optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, 'nothing to update');
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
  /** Counts are filled for meetings that have a saved roll call. */
  counts: Record<AttendanceStatus, number>;
}

export const createMeetingSchema = z.object({
  /** Local calendar date in the church time zone. */
  date,
  startTime: time,
  durationMin: duration.default(120),
  title: name,
});
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object({
  status: z.enum(['scheduled', 'cancelled']).optional(),
  title: name.optional(),
  notes: optionalText(500).optional(),
});
export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

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
  nextMeeting: { id: number; title: string; startsAt: string; endsAt: string } | null;
}

export interface MyAttendanceResponse {
  groups: MemberAttendance[];
}
