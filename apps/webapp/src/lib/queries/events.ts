import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SetProgramInput,
  DutiesNotice,
  NotifyDutiesInput,
  RemindEventInput,
} from '@church/shared';
import type {
  CreateEventInput,
  EventDetail,
  EventSummary,
  RoleInput,
  RsvpStatus,
  UpdateEventInput,
  UpdateGroupInput,
} from '@church/shared';
import { apiFetch } from '../api';
import { keys, send, useInvalidateAll } from './core';

// ---------- events ----------

export function useEvents(groupId: number, scope: 'upcoming' | 'past', enabled = true) {
  return useQuery({
    queryKey: keys.events(groupId, scope),
    queryFn: () => apiFetch<EventSummary[]>(`/groups/${groupId}/events?scope=${scope}`),
    enabled,
  });
}

/** The default reminder text of an event (plain text to edit). */
export const fetchReminderText = (eventId: number) =>
  apiFetch<{ text: string }>(`/events/${eventId}/reminder-text`);

/** Remind everyone in the ministry, or chosen people, about an event. */
export function useRemindEvent() {
  return useMutation({
    mutationFn: ({ id, ...input }: RemindEventInput & { id: number }) =>
      apiFetch<{ sent: number }>(`/events/${id}/remind`, send('POST', input)),
  });
}

export function useTestRemindEvent() {
  return useMutation({
    mutationFn: ({ id, ...input }: RemindEventInput & { id: number }) =>
      apiFetch<{ sent: number }>(`/events/${id}/remind/test`, send('POST', input)),
  });
}

export function useRequestRemindEvent() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, ...input }: RemindEventInput & { id: number }) =>
      apiFetch<{ id: number; asked: number }>(`/events/${id}/remind/request`, send('POST', input)),
    onSuccess: invalidate,
  });
}

/** The event's cover photo with its effects recorded as a loop (or removed with null). */
export function useCoverLoop(eventId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (video: Blob | null): Promise<unknown> =>
      video
        ? apiFetch<{ mediaId: number }>(`/events/${eventId}/cover-loop`, {
            method: 'POST',
            body: video,
            headers: { 'content-type': 'video/mp4' },
          })
        : apiFetch<{ ok: true }>(`/events/${eventId}/cover-loop`, send('DELETE')),
    onSuccess: invalidate,
  });
}

export function useEvent(id: number, enabled = true) {
  return useQuery({
    queryKey: keys.event(id),
    queryFn: () => apiFetch<EventDetail>(`/events/${id}`),
    enabled,
  });
}

export function useMyEvents(enabled = true) {
  return useQuery({
    queryKey: keys.myEvents,
    queryFn: () => apiFetch<EventSummary[]>('/me/events'),
    enabled,
  });
}

/** After any event change: store the fresh detail, refresh lists (and money, if touched). */
function useEventSaved() {
  const qc = useQueryClient();
  return (e: EventDetail) => {
    qc.setQueryData(keys.event(e.id), e);
    void qc.invalidateQueries({ queryKey: ['groups', e.groupId, 'events'] });
    void qc.invalidateQueries({ queryKey: keys.myEvents });
    void qc.invalidateQueries({ queryKey: keys.treasury(e.groupId) });
  };
}

function useEventMutation<I, R extends EventDetail = EventDetail>(
  request: (input: I) => Promise<R>,
) {
  const saved = useEventSaved();
  return useMutation({ mutationFn: request, onSuccess: saved });
}

export function useCreateEvent(groupId: number) {
  return useEventMutation((input: CreateEventInput) =>
    apiFetch<EventDetail>(`/groups/${groupId}/events`, send('POST', input)),
  );
}

export function useUpdateEvent(id: number) {
  return useEventMutation((input: UpdateEventInput) =>
    apiFetch<EventDetail>(`/events/${id}`, send('PATCH', input)),
  );
}

export function useSetRoles(id: number) {
  return useEventMutation((input: { roles: RoleInput[]; notify?: boolean }) =>
    apiFetch<EventDetail & { notified: DutiesNotice | null }>(
      `/events/${id}/roles`,
      send('PUT', input),
    ),
  );
}

/** Write again to the people already assigned (everyone, or one duty's people). */
/** Replace the event's programme. */
export function useSetProgram(id: number) {
  return useEventMutation((input: SetProgramInput) =>
    apiFetch<EventDetail>(`/events/${id}/program`, send('PUT', input)),
  );
}

export function useNotifyDuties(id: number) {
  return useMutation({
    mutationFn: (input: NotifyDutiesInput) =>
      apiFetch<DutiesNotice>(`/events/${id}/duties/notify`, send('POST', input)),
  });
}

export function useRsvp(id: number) {
  return useEventMutation((input: { status: RsvpStatus | null; userId?: number }) =>
    apiFetch<EventDetail>(`/events/${id}/rsvp`, send('PUT', input)),
  );
}

export function useAddPhotos(id: number) {
  return useEventMutation((mediaIds: number[]) =>
    apiFetch<EventDetail>(`/events/${id}/photos`, send('POST', { mediaIds })),
  );
}

export function useDeletePhoto(id: number) {
  return useEventMutation((photoId: number) =>
    apiFetch<EventDetail>(`/events/${id}/photos/${photoId}`, send('DELETE')),
  );
}

export function useEventPayment(id: number) {
  return useEventMutation((input: { userId: number; amountCents?: number }) =>
    apiFetch<EventDetail>(`/events/${id}/payments`, send('POST', input)),
  );
}

export function useEventExpense(id: number) {
  return useEventMutation(
    (input: { amountCents: number; note?: string | null; receiptMediaId?: number | null }) =>
      apiFetch<EventDetail>(`/events/${id}/expenses`, send('POST', input)),
  );
}

export function useUpdateGroup(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGroupInput) => apiFetch(`/groups/${groupId}`, send('PATCH', input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.group(groupId) });
      void qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}
