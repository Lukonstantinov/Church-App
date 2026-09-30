import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddOfflineMemberInput,
  ClaimCodeResponse,
  CreateGroupInput,
  GroupDetail,
  GroupSummary,
  MeResponse,
  MemberDetail,
  MemberRow,
  UpdateMembershipInput,
  UpdateUserInput,
} from '@church/shared';
import { apiFetch } from './api';

export const keys = {
  me: ['me'] as const,
  groups: ['groups'] as const,
  group: (id: number) => ['groups', id] as const,
  members: (id: number) => ['groups', id, 'members'] as const,
  user: (id: number) => ['users', id] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => apiFetch<MeResponse>('/me') });
}

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: keys.groups,
    queryFn: () => apiFetch<GroupSummary[]>('/groups'),
    enabled,
  });
}

export function useGroup(id: number) {
  return useQuery({
    queryKey: keys.group(id),
    queryFn: () => apiFetch<GroupDetail>(`/groups/${id}`),
  });
}

export function useMembers(groupId: number, enabled = true) {
  return useQuery({
    queryKey: keys.members(groupId),
    queryFn: () => apiFetch<MemberRow[]>(`/groups/${groupId}/members`),
    enabled,
  });
}

export function useMemberDetail(userId: number) {
  return useQuery({
    queryKey: keys.user(userId),
    queryFn: () => apiFetch<MemberDetail>(`/users/${userId}`),
  });
}

/** Most writes touch groups/members/users; refreshing all of them keeps screens consistent. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['groups'] }),
      qc.invalidateQueries({ queryKey: ['users'] }),
      qc.invalidateQueries({ queryKey: keys.me }),
    ]);
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export function useCreateGroup() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateGroupInput) =>
      apiFetch<{ id: number }>('/groups', { method: 'POST', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useArchiveGroup() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (groupId: number) => apiFetch(`/groups/${groupId}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRotateInvite() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (groupId: number) =>
      apiFetch<{ inviteLink: string }>(`/groups/${groupId}/invite/rotate`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useAddOffline(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: AddOfflineMemberInput) =>
      apiFetch<{ userId: number }>(`/groups/${groupId}/members`, {
        method: 'POST',
        ...json(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateMembership() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ membershipId, ...input }: UpdateMembershipInput & { membershipId: number }) =>
      apiFetch(`/memberships/${membershipId}`, { method: 'PATCH', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useUpdateUser(userId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: UpdateUserInput) =>
      apiFetch(`/users/${userId}`, { method: 'PATCH', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useIssueClaimCode(userId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: () =>
      apiFetch<ClaimCodeResponse>(`/users/${userId}/claim-code`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useSetAdmin(userId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (isAdmin: boolean) =>
      apiFetch(`/users/${userId}/admin`, { method: 'POST', ...json({ isAdmin }) }),
    onSuccess: invalidate,
  });
}
