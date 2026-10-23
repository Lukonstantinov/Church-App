import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MeetingComment,
  AnnounceMeetingInput,
  MeetingNotice,
  MeetingRsvpStatus,
  MessageTemplateInput,
  MessageTemplateRow,
  AnswerMeetingInput,
  AssignmentRow,
  CalendarData,
  CalendarNoteInput,
  NotifyMeetingInput,
  ContactRow,
  MeetingDetail,
  MeetingHelper,
  MeetingService,
  AddHelperInput,
  MeetingPerson,
  CreateMeetingInput,
  MeetingRow,
  SaveRollInput,
  UpdateMeetingInput,
} from '@church/shared';
import { apiFetch } from '../api';
import { keys, json, send, useInvalidateAll } from './core';

export function useCreateMeeting(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateMeetingInput) =>
      apiFetch<MeetingRow>(`/groups/${groupId}/meetings`, { method: 'POST', ...json(input) }),
    onSuccess: invalidate,
  });
}

/** Everyone active in the ministry with their position (any member may see it). */
export function useContacts(groupId: number, enabled = true) {
  return useQuery({
    queryKey: ['groups', groupId, 'contacts'],
    queryFn: () => apiFetch<ContactRow[]>(`/groups/${groupId}/contacts`),
    enabled,
  });
}

export function useMeeting(id: number) {
  return useQuery({
    queryKey: ['meeting', id],
    queryFn: () => apiFetch<MeetingDetail>(`/meetings/${id}`),
  });
}

/** A meeting's comments (fetched only once the fold is opened). */
export function useMeetingComments(meetingId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['meeting', meetingId, 'comments'],
    queryFn: () => apiFetch<MeetingComment[]>(`/meetings/${meetingId}/comments`),
    enabled,
    refetchInterval: enabled ? 15000 : false,
    staleTime: 0,
  });
}

export function usePostMeetingComment(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<MeetingComment>(`/meetings/${meetingId}/comments`, send('POST', { text })),
    // The meeting's own count changes too.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['meeting', meetingId] }),
  });
}

export function useDeleteMeetingComment(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) =>
      apiFetch(`/meetings/${meetingId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['meeting', meetingId] }),
  });
}

/** Members to pick a meeting's leader or snack person from. */
export function useMeetingPeople(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['meeting', id, 'people'],
    queryFn: () => apiFetch<MeetingPerson[]>(`/meetings/${id}/people`),
    enabled,
  });
}

/** The ministry calendar: meetings, events and (for leaders) colour notes. */
export function useCalendar(groupId: number) {
  return useQuery({
    queryKey: ['groups', groupId, 'calendar'],
    queryFn: () => apiFetch<CalendarData>(`/groups/${groupId}/calendar`),
  });
}

export function useSaveNote(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CalendarNoteInput & { id?: number }) =>
      id
        ? apiFetch(`/calendar-notes/${id}`, { method: 'PATCH', ...json(input) })
        : apiFetch(`/groups/${groupId}/calendar-notes`, { method: 'POST', ...json(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['groups', groupId, 'calendar'] }),
  });
}

export function useDeleteNote(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/calendar-notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['groups', groupId, 'calendar'] }),
  });
}

/** The message for a meeting's leader or snack person (plain text to edit): the default, or a saved wording. */
export const fetchNotifyText = (
  meetingId: number,
  role: 'leader' | 'snack',
  notes: string,
  templateId?: number,
) =>
  apiFetch<{ text: string }>(
    `/meetings/${meetingId}/notify-text?role=${role}&notes=${encodeURIComponent(notes)}${
      templateId ? `&template=${templateId}` : ''
    }`,
  );

/** Saved message wordings of the meeting's ministry. */
export function useMessageTemplates(meetingId: number) {
  return useQuery({
    queryKey: ['meetings', meetingId, 'message-templates'],
    queryFn: () => apiFetch<MessageTemplateRow[]>(`/meetings/${meetingId}/message-templates`),
  });
}

export function useSaveMessageTemplate(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MessageTemplateInput) =>
      apiFetch<MessageTemplateRow>(`/meetings/${meetingId}/message-templates`, {
        method: 'POST',
        ...json(input),
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['meetings', meetingId, 'message-templates'] }),
  });
}

export function useDeleteMessageTemplate(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/message-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['meetings', meetingId, 'message-templates'] }),
  });
}

/** Send the leader or snack person their bot message (with the meeting notes). */
/** Meetings the person leads or buys snacks for, with what is still to fill in. */
export function useAssignments() {
  return useQuery({
    queryKey: ['me', 'assignments'],
    queryFn: () => apiFetch<AssignmentRow[]>('/me/assignments'),
  });
}

export function useAnswerMeeting() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: AnswerMeetingInput & { id: number }) =>
      apiFetch<{ ok: true }>(`/meetings/${id}/answer`, { method: 'POST', ...json(input) }),
    onSuccess: invalidate,
  });
}

export function useNotifyMeeting() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: NotifyMeetingInput & { id: number }) =>
      apiFetch<{ sent: boolean }>(`/meetings/${id}/notify`, { method: 'POST', ...json(input) }),
    onSuccess: invalidate,
  });
}

/** The default announcement of a meeting (sender's language), to read and change. */
export const fetchMeetingAnnounceText = (
  meetingId: number,
  notice: MeetingNotice = 'announce',
  from?: string | null,
) =>
  apiFetch<{ text: string }>(
    `/meetings/${meetingId}/announce-text?notice=${notice}${from ? `&from=${encodeURIComponent(from)}` : ''}`,
  );

/** "Will you come?" — the viewer's own answer. */
export function useMeetingRsvp(meetingId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (status: MeetingRsvpStatus) =>
      apiFetch<{ ok: true }>(`/meetings/${meetingId}/rsvp`, send('POST', { status })),
    onSuccess: invalidate,
  });
}

/** Tell everyone (or leaders / chosen people) about a meeting, with its poster. */
export function useAnnounceMeeting() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: AnnounceMeetingInput & { id: number }) =>
      apiFetch<{ sent: number; bot: number }>(`/meetings/${id}/announce`, send('POST', input)),
    onSuccess: invalidate,
  });
}

/** The prepared announcement sent only to oneself, to see it in Telegram. */
export function useTestAnnounceMeeting() {
  return useMutation({
    mutationFn: ({ id, ...input }: AnnounceMeetingInput & { id: number }) =>
      apiFetch<{ sent: number }>(`/meetings/${id}/announce/test`, send('POST', input)),
  });
}

/** A designer hands the prepared announcement to those who may send it. */
export function useRequestAnnounceMeeting() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: AnnounceMeetingInput & { id: number }) =>
      apiFetch<{ id: number; asked: number }>(
        `/meetings/${id}/announce/request`,
        send('POST', input),
      ),
    onSuccess: invalidate,
  });
}

/** An approver sends a prepared announcement / reminder to everyone, or declines it. */
export function useDecidePublish() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, send: go }: { id: number; send: boolean }) =>
      apiFetch<{ sent: number }>(
        `/publish-requests/${id}/${go ? 'send' : 'decline'}`,
        send('POST'),
      ),
    onSuccess: invalidate,
  });
}

/** Deletes a meeting for good (the only way one disappears). */
export function useDeleteMeeting() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => apiFetch<{ ok: true }>(`/meetings/${id}`, send('DELETE')),
    onSuccess: invalidate,
  });
}

export function useUpdateMeeting() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateMeetingInput & { id: number }) =>
      apiFetch<MeetingRow>(`/meetings/${id}`, {
        method: 'PATCH',
        ...json(input),
      }),
    onSuccess: invalidate,
  });
}

/** More people with a job at a meeting: add, remove, ask (by bot), answer. */
export function useMeetingHelpers(meetingId: number) {
  const invalidate = useInvalidateAll();
  const add = useMutation({
    mutationFn: (input: AddHelperInput) =>
      apiFetch<MeetingHelper[]>(`/meetings/${meetingId}/helpers`, {
        method: 'POST',
        ...json(input),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (helperId: number) =>
      apiFetch<MeetingHelper[]>(`/meetings/${meetingId}/helpers/${helperId}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  });
  const notify = useMutation({
    mutationFn: (helperId: number) =>
      apiFetch<{ sent: boolean }>(`/meetings/${meetingId}/helpers/${helperId}/notify`, {
        method: 'POST',
      }),
    onSuccess: invalidate,
  });
  const answer = useMutation({
    mutationFn: ({ helperId, agree }: { helperId: number; agree: boolean }) =>
      apiFetch<{ ok: true }>(`/meetings/${meetingId}/helpers/${helperId}/answer`, {
        method: 'POST',
        ...json({ agree }),
      }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ helperId, ...input }: { helperId: number; role?: string; icon?: string }) =>
      apiFetch<MeetingHelper[]>(`/meetings/${meetingId}/helpers/${helperId}`, {
        method: 'PATCH',
        ...json(input),
      }),
    onSuccess: invalidate,
  });
  const roster = useMutation({
    mutationFn: (to: 'everyone' | 'team') =>
      apiFetch<{ total: number; bot: number }>(`/meetings/${meetingId}/roster`, {
        method: 'POST',
        ...json({ to }),
      }),
  });
  return { add, remove, notify, answer, update, roster };
}

/** Replaces the ministry's saved list of meeting services. */
export function useSaveMeetingServices(groupId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (services: MeetingService[]) =>
      apiFetch<MeetingService[]>(`/groups/${groupId}/services`, {
        method: 'PUT',
        ...json({ services }),
      }),
    onSuccess: invalidate,
  });
}

/** Sets a person's photo (shown on meeting cards); null removes it. */
export function usePersonPhoto(meetingId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ userId, mediaId }: { userId: number; mediaId: number | null }) =>
      apiFetch<{ ok: true }>(`/meetings/${meetingId}/people/${userId}/photo`, {
        method: 'PUT',
        ...json({ mediaId }),
      }),
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
