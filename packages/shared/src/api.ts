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
