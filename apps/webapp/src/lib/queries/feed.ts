import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ResendPostInput,
  UpdateAnnouncementInput,
  AnnouncementResult,
  AnnouncementRow,
  PosterTemplate,
  EffectTemplate,
  EffectTemplateInput,
  PosterTemplateInput,
} from '@church/shared';
import type {
  CommentRow,
  CreateAnnouncementInput,
  DesignTemplate,
  TemplateInput,
  EventSummary,
} from '@church/shared';
import { apiFetch } from '../api';
import { keys, json, send } from './core';

// ---------- announcements ----------

export function useAnnouncements(groupId: number) {
  return useQuery({
    queryKey: keys.announcements(groupId),
    queryFn: () => apiFetch<AnnouncementRow[]>(`/groups/${groupId}/announcements`),
  });
}

export function useMyAnnouncements(enabled = true) {
  return useQuery({
    queryKey: keys.myAnnouncements,
    queryFn: () => apiFetch<AnnouncementRow[]>('/me/announcements'),
    enabled,
  });
}

/** Publishes a post; a plain string is a text-only announcement. */
export function useSendAnnouncement(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | CreateAnnouncementInput) =>
      apiFetch<AnnouncementResult>(`/groups/${groupId}/announcements`, {
        method: 'POST',
        ...json(typeof input === 'string' ? { text: input } : input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.announcements(groupId) });
      void qc.invalidateQueries({ queryKey: keys.myAnnouncements });
    },
  });
}

/** The ministry's feed, newest first, paged by post id. */
export function useFeed(groupId: number) {
  return useInfiniteQuery({
    queryKey: [...keys.announcements(groupId), 'feed'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiFetch<AnnouncementRow[]>(
        `/groups/${groupId}/announcements${pageParam ? `?before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => (last.length >= 20 ? last[last.length - 1]!.id : undefined),
  });
}

function useFeedChanged(groupId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.announcements(groupId) });
    void qc.invalidateQueries({ queryKey: keys.myAnnouncements });
  };
}

export function useReact(groupId: number) {
  const changed = useFeedChanged(groupId);
  return useMutation({
    mutationFn: ({ postId, emoji }: { postId: number; emoji: string }) =>
      apiFetch(`/announcements/${postId}/reactions`, send('POST', { emoji })),
    onSuccess: changed,
  });
}

export function useComments(postId: number) {
  return useQuery({
    queryKey: ['announcements', postId, 'comments'],
    queryFn: () => apiFetch<CommentRow[]>(`/announcements/${postId}/comments`),
    // A light "live" chat: refresh while the post is open.
    refetchInterval: 10_000,
  });
}

export function useAddComment(groupId: number, postId: number) {
  const qc = useQueryClient();
  const changed = useFeedChanged(groupId);
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<CommentRow[]>(`/announcements/${postId}/comments`, send('POST', { text })),
    onSuccess: (list) => {
      qc.setQueryData(['announcements', postId, 'comments'], list);
      changed();
    },
  });
}

export function useDeleteComment(groupId: number, postId: number) {
  const qc = useQueryClient();
  const changed = useFeedChanged(groupId);
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/comments/${id}`, send('DELETE')),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['announcements', postId, 'comments'] });
      changed();
    },
  });
}

export function useDeletePost(groupId: number) {
  const changed = useFeedChanged(groupId);
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/announcements/${id}`, send('DELETE')),
    onSuccess: changed,
  });
}

export function useEditPost(groupId: number) {
  const changed = useFeedChanged(groupId);
  return useMutation({
    mutationFn: ({ postId, input }: { postId: number; input: UpdateAnnouncementInput }) =>
      apiFetch(`/announcements/${postId}`, send('PATCH', input)),
    onSuccess: changed,
  });
}

export function useVote(groupId: number) {
  const changed = useFeedChanged(groupId);
  return useMutation({
    mutationFn: ({
      postId,
      blockId,
      options,
    }: {
      postId: number;
      blockId: string;
      options: number[];
    }) => apiFetch(`/announcements/${postId}/vote`, send('POST', { blockId, options })),
    onSuccess: changed,
  });
}

/** Attach a document to a post (raw upload; the name decides its type). */
export function useUploadFile(groupId: number) {
  return useMutation({
    mutationFn: (file: File) =>
      apiFetch<{ id: number; name: string; bytes: number; mime: string; url: string }>(
        `/groups/${groupId}/files?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } },
      ),
  });
}

/** Send a post's notification again to everyone or chosen people. */
export function useResendPost() {
  return useMutation({
    mutationFn: ({ postId, ...input }: ResendPostInput & { postId: number }) =>
      apiFetch<{ sent: number }>(`/announcements/${postId}/resend`, send('POST', input)),
  });
}

export function usePinPost(groupId: number) {
  const changed = useFeedChanged(groupId);
  return useMutation({
    mutationFn: ({ postId, pinned }: { postId: number; pinned: boolean }) =>
      apiFetch(`/announcements/${postId}/pin`, send('POST', { pinned })),
    onSuccess: changed,
  });
}

/** Opening a post clears its own new-messages counter (and the card's red one). */
export function useMarkPostRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) => apiFetch(`/announcements/${postId}/read`, send('POST')),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: keys.myAnnouncements });
    },
  });
}

/** Opening the feed clears the unread counters on the ministry card. */
export function useMarkFeedRead(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/groups/${groupId}/feed/read`, send('POST')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.groups }),
  });
}

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => apiFetch<DesignTemplate[]>('/templates'),
    enabled,
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    // With an id: change that template (meetings using it follow); without: a new one.
    mutationFn: ({ id, ...input }: TemplateInput & { id?: number }) =>
      id
        ? apiFetch<{ id: number }>(`/templates/${id}`, send('PUT', input))
        : apiFetch<{ id: number }>('/templates', send('POST', input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      // Meetings show a template's animation, so they refresh too.
      void qc.invalidateQueries({ queryKey: ['meeting'] });
      void qc.invalidateQueries({ queryKey: ['groups'] });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/templates/${id}`, send('DELETE')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function usePosterTemplates(enabled = true) {
  return useQuery({
    queryKey: ['posterTemplates'],
    queryFn: () => apiFetch<PosterTemplate[]>('/poster-templates'),
    enabled,
  });
}

export function useSavePosterTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: PosterTemplateInput & { id?: number }) =>
      id
        ? apiFetch<PosterTemplate>(`/poster-templates/${id}`, send('PUT', input))
        : apiFetch<PosterTemplate>('/poster-templates', send('POST', input)),
    // Events and meetings wearing it show the change too.
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useDeletePosterTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/poster-templates/${id}`, send('DELETE')),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/** Saved sets of effects (shared church-wide); quietly empty for those who may not use them. */
export function useEffectTemplates(enabled = true) {
  return useQuery({
    queryKey: ['effectTemplates'],
    queryFn: () => apiFetch<EffectTemplate[]>('/effect-templates'),
    enabled,
    retry: false,
  });
}

export function useSaveEffectTemplate() {
  const qc = useQueryClient();
  return useMutation({
    // With an id: that own effect changes (everywhere it is used); without: a new one.
    mutationFn: ({ id, ...input }: EffectTemplateInput & { id?: number }) =>
      id
        ? apiFetch<EffectTemplate>(`/effect-templates/${id}`, send('PUT', input))
        : apiFetch<EffectTemplate>('/effect-templates', send('POST', input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['effectTemplates'] }),
  });
}

export function useDeleteEffectTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/effect-templates/${id}`, send('DELETE')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['effectTemplates'] }),
  });
}

export function usePinnedEvents(enabled = true) {
  return useQuery({
    queryKey: ['events', 'pinned'],
    queryFn: () => apiFetch<EventSummary[]>('/events/pinned'),
    enabled,
  });
}
