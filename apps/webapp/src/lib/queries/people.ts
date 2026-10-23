import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LabelInput, LabelRef, SetMemberLabelsInput, GroupSummary } from '@church/shared';
import type {
  AddExistingMemberInput,
  PersonSearchRow,
  PositionInput,
  PositionRow,
} from '@church/shared';
import { apiFetch } from '../api';
import { keys, send } from './core';

// ---------- positions & people ----------

export function usePositions(groupId: number, enabled = true) {
  return useQuery({
    queryKey: keys.positions(groupId),
    queryFn: () => apiFetch<PositionRow[]>(`/groups/${groupId}/positions`),
    enabled,
  });
}

function usePositionsSaved(groupId: number) {
  const qc = useQueryClient();
  return (list: PositionRow[]) => {
    qc.setQueryData(keys.positions(groupId), list);
    // Position chips show in the people list, contacts and profiles.
    void qc.invalidateQueries({ queryKey: ['groups', groupId] });
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: keys.groups });
    void qc.invalidateQueries({ queryKey: keys.me });
  };
}

export function useSavePosition(groupId: number) {
  const saved = usePositionsSaved(groupId);
  return useMutation({
    mutationFn: ({ id, ...input }: PositionInput & { id?: number }) =>
      id
        ? apiFetch<PositionRow[]>(`/positions/${id}`, send('PATCH', input))
        : apiFetch<PositionRow[]>(`/groups/${groupId}/positions`, send('POST', input)),
    onSuccess: saved,
  });
}

/** New top-to-bottom order of the positions (the order of the member lists). */
export function useReorderPositions(groupId: number) {
  const saved = usePositionsSaved(groupId);
  return useMutation({
    mutationFn: (ids: number[]) =>
      apiFetch<PositionRow[]>(`/groups/${groupId}/positions/order`, send('PUT', { ids })),
    onSuccess: saved,
  });
}

export function useDeletePosition(groupId: number) {
  const saved = usePositionsSaved(groupId);
  return useMutation({
    mutationFn: (id: number) => apiFetch<PositionRow[]>(`/positions/${id}`, send('DELETE')),
    onSuccess: saved,
  });
}

export function usePeopleSearch(groupId: number, q: string) {
  return useQuery({
    queryKey: keys.peopleSearch(groupId, q),
    queryFn: () =>
      apiFetch<PersonSearchRow[]>(`/groups/${groupId}/people-search?q=${encodeURIComponent(q)}`),
    placeholderData: (prev) => prev,
  });
}

export function useAddExisting(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddExistingMemberInput) =>
      apiFetch<{ userId: number }>(`/groups/${groupId}/members/existing`, send('POST', input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['groups', groupId] });
      void qc.invalidateQueries({ queryKey: keys.groups });
    },
  });
}

// ---------- ministry chat & lifecycle ----------

export function useLinkChat(groupId: number) {
  return useMutation({
    mutationFn: () => apiFetch<{ url: string }>(`/groups/${groupId}/chat/link`, send('POST')),
  });
}

export function useUnlinkChat(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/groups/${groupId}/chat`, send('DELETE')),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.group(groupId) });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useRestoreGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: number) => apiFetch(`/groups/${groupId}/restore`, send('POST')),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/** Admins only: deleted (archived) ministries. */
export function useArchivedGroups(enabled: boolean) {
  return useQuery({
    queryKey: ['groups', 'archived'],
    queryFn: async () =>
      (await apiFetch<GroupSummary[]>('/groups?archived=1')).filter((g) => g.archived),
    enabled,
  });
}

// ---------- labels ----------

export function useLabels(groupId: number, enabled = true) {
  return useQuery({
    queryKey: ['groups', groupId, 'labels'],
    queryFn: () => apiFetch<LabelRef[]>(`/groups/${groupId}/labels`),
    enabled,
  });
}

export function useSaveLabel(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: LabelInput & { id?: number }) =>
      id
        ? apiFetch<LabelRef>(`/labels/${id}`, send('PATCH', input))
        : apiFetch<LabelRef>(`/groups/${groupId}/labels`, send('POST', input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['groups', groupId] }),
  });
}

export function useDeleteLabel(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/labels/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['groups', groupId] }),
  });
}

/** Which of the ministry's labels a person has. */
export function useSetMemberLabels(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, labelIds }: { userId: number } & SetMemberLabelsInput) =>
      apiFetch(`/groups/${groupId}/members/${userId}/labels`, send('PUT', { labelIds })),
    // Labels show in the people list, contacts, the profile and the main page.
    onSuccess: (_d, { userId }) => {
      void qc.invalidateQueries({ queryKey: ['groups', groupId] });
      void qc.invalidateQueries({ queryKey: keys.user(userId) });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
