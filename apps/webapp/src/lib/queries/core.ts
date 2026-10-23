import { useQueryClient } from '@tanstack/react-query';

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
  myAnnouncements: ['me', 'announcements'] as const,
  announcements: (groupId: number) => ['groups', groupId, 'announcements'] as const,
  treasury: (groupId: number) => ['groups', groupId, 'treasury'] as const,
  transactions: (groupId: number, filter: string) =>
    ['groups', groupId, 'treasury', 'tx', filter] as const,
  dues: (groupId: number, year: number) => ['groups', groupId, 'treasury', 'dues', year] as const,
  myFinance: ['me', 'finance'] as const,
  events: (groupId: number, scope: string) => ['groups', groupId, 'events', scope] as const,
  event: (id: number) => ['events', id] as const,
  myEvents: ['me', 'events'] as const,
  positions: (groupId: number) => ['groups', groupId, 'positions'] as const,
  peopleSearch: (groupId: number, q: string) => ['groups', groupId, 'people-search', q] as const,
};

/** Most writes touch groups/members/users; refreshing all of them keeps screens consistent. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['groups'] }),
      qc.invalidateQueries({ queryKey: ['users'] }),
      qc.invalidateQueries({ queryKey: keys.me }),
      qc.invalidateQueries({ queryKey: ['meetings'] }),
      qc.invalidateQueries({ queryKey: ['meeting'] }),
    ]);
}

export const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
