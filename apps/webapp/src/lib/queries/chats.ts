import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationsResponse,
  ReadNotificationsInput,
  EventChatMessage,
} from '@church/shared';
import { apiFetch } from '../api';
import { keys, send } from './core';

// ---------- event chat ----------

/** The in-app chat of an event; refreshed every few seconds while it is open. */
export function useEventChat(eventId: number, enabled = true) {
  return useQuery({
    queryKey: ['events', eventId, 'chat'],
    queryFn: () => apiFetch<EventChatMessage[]>(`/events/${eventId}/chat`),
    enabled,
    refetchInterval: 8000,
    staleTime: 0,
  });
}

export function usePostEventChat(eventId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<EventChatMessage>(`/events/${eventId}/chat`, send('POST', { text })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['events', eventId, 'chat'] }),
  });
}

export function useDeleteEventChat(eventId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) =>
      apiFetch(`/events/${eventId}/chat/${messageId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['events', eventId, 'chat'] }),
  });
}

/** The link that adds the bot to a new or existing Telegram group, making it the event's chat. */
export function useLinkEventChat(eventId: number) {
  return useMutation({
    mutationFn: () => apiFetch<{ url: string }>(`/events/${eventId}/chat/link`, send('POST')),
  });
}

export function useUnlinkEventChat(eventId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/events/${eventId}/chat`, send('DELETE')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.event(eventId) }),
  });
}

// ---------- notification inbox ----------

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ['me', 'notifications'],
    queryFn: () => apiFetch<NotificationsResponse>('/me/notifications'),
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

export function useReadNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReadNotificationsInput) =>
      apiFetch('/me/notifications/read', send('POST', input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'notifications'] }),
  });
}

/** Fresh links to poster pictures (a design draft kept on the phone gets them back). */
export const posterLinks = (ids: number[]) =>
  apiFetch<Record<number, string>>('/poster-templates/links', send('POST', { ids }));
