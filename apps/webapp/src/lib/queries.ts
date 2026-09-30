import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddOfflineMemberInput,
  CreateMeetingInput,
  CreateScheduleInput,
  GroupStats,
  MeetingRow,
  MyAttendanceResponse,
  RollResponse,
  SaveRollInput,
  ScheduleRow,
  UpdateMeetingInput,
  UpdateScheduleInput,
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
  stats: (groupId: number) => ['groups', groupId, 'stats'] as const,
  upcoming: (groupId: number) => ['groups', groupId, 'meetings', 'upcoming'] as const,
  past: (groupId: number, limit: number) => ['groups', groupId, 'meetings', 'past', limit] as const,
  schedules: (groupId: number) => ['groups', groupId, 'schedules'] as const,
  roll: (meetingId: number) => ['meetings', meetingId, 'roll'] as const,
  myAttendance: ['me', 'attendance'] as const,
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

export function useGroupStats(groupId: number | null) {
  return useQuery({
    queryKey: keys.stats(groupId ?? 0),
    queryFn: () => apiFetch<GroupStats>(`/groups/${groupId}/stats`),
    enabled: groupId !== null,
  });
}

export function useUpcoming(groupId: number | null) {
  return useQuery({
    queryKey: keys.upcoming(groupId ?? 0),
    queryFn: () => apiFetch<MeetingRow[]>(`/groups/${groupId}/meetings?limit=30`),
    enabled: groupId !== null,
  });
}

export function usePast(groupId: number | null, limit: number, enabled = true) {
  return useQuery({
    queryKey: keys.past(groupId ?? 0, limit),
    queryFn: () => apiFetch<MeetingRow[]>(`/groups/${groupId}/meetings?scope=past&limit=${limit}`),
    enabled: groupId !== null && enabled,
  });
}

export function useSchedules(groupId: number) {
  return useQuery({
    queryKey: keys.schedules(groupId),
    queryFn: () => apiFetch<ScheduleRow[]>(`/groups/${groupId}/schedules`),
  });
}

export function useRoll(meetingId: number) {
  return useQuery({
    queryKey: keys.roll(meetingId),
    queryFn: () => apiFetch<RollResponse>(`/meetings/${meetingId}/roll`),
    // The roster is edited locally; don't overwrite it by refetching in the background.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useMyAttendance(enabled = true) {
  return useQuery({
    queryKey: keys.myAttendance,
    queryFn: () => apiFetch<MyAttendanceResponse>('/me/attendance'),
    enabled,
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
      qc.invalidateQueries({ queryKey: ['meetings'] }),
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

export function useCreateSchedule(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateScheduleInput) =>
      apiFetch<ScheduleRow>(`/groups/${groupId}/schedules`, { method: 'POST', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useUpdateSchedule() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateScheduleInput & { id: number }) =>
      apiFetch<ScheduleRow>(`/schedules/${id}`, { method: 'PATCH', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useDeleteSchedule() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useCreateMeeting(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateMeetingInput) =>
      apiFetch<MeetingRow>(`/groups/${groupId}/meetings`, { method: 'POST', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useUpdateMeeting() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateMeetingInput & { id: number }) =>
      apiFetch<MeetingRow>(`/meetings/${id}`, { method: 'PATCH', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useSaveRoll(meetingId: number) {
  const invalidate = useInvalidateAll();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveRollInput) =>
      apiFetch<MeetingRow>(`/meetings/${meetingId}/roll`, { method: 'PUT', ...json(input) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.roll(meetingId) });
      await invalidate();
    },
  });
}
