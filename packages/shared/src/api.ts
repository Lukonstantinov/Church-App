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

export interface MeResponse {
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
