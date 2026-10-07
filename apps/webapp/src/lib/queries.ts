import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SetProgramInput,
  NotificationsResponse,
  ReadNotificationsInput,
  DutiesNotice,
  NotifyDutiesInput,
  EventChatMessage,
  LabelInput,
  LabelRef,
  SetMemberLabelsInput,
  GroupStatistics,
  AnnounceMeetingInput,
  MeetingNotice,
  MeetingRsvpStatus,
  ResendPostInput,
  RemindEventInput,
  MessageTemplateInput,
  MessageTemplateRow,
  AnswerMeetingInput,
  AssignmentRow,
  UpdateAnnouncementInput,
  CalendarData,
  CalendarNoteInput,
  NotifyMeetingInput,
  ContactRow,
  MeetingDetail,
  MeetingHelper,
  MeetingService,
  AddHelperInput,
  MeetingPerson,
  AddOfflineMemberInput,
  AnnouncementResult,
  AnnouncementRow,
  ChurchInfo,
  Locale,
  UpdateChurchInput,
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
import type {
  CommentRow,
  CreateAnnouncementInput,
  DesignTemplate,
  TemplateInput,
  AddExistingMemberInput,
  PersonSearchRow,
  PositionInput,
  PositionRow,
  AttendanceExport,
  TreasuryExport,
  CreateEventInput,
  EventDetail,
  EventSummary,
  RoleInput,
  RsvpStatus,
  UpdateEventInput,
  UpdateGroupInput,
  CreateTransactionInput,
  DuesSheet,
  MyFinanceGroup,
  PayDuesInput,
  TransactionPage,
  TransactionRow,
  TreasurySettingsInput,
  TreasurySummary,
  UpdateTransactionInput,
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
    queryFn: () => apiFetch<MeetingRow[]>(`/groups/${groupId}/meetings?limit=100`),
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
      qc.invalidateQueries({ queryKey: ['meeting'] }),
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

/** Everyone active in the ministry with their position (any member may see it). */
export function useContacts(groupId: number) {
  return useQuery({
    queryKey: ['groups', groupId, 'contacts'],
    queryFn: () => apiFetch<ContactRow[]>(`/groups/${groupId}/contacts`),
  });
}

export function useMeeting(id: number) {
  return useQuery({
    queryKey: ['meeting', id],
    queryFn: () => apiFetch<MeetingDetail>(`/meetings/${id}`),
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
  return { add, remove, notify, answer };
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

// ---------- language & church settings ----------

/** Switches the UI language immediately, then saves it for this user. */
export function useSetLocale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locale: Locale) =>
      apiFetch<MeResponse>('/me', { method: 'PATCH', ...json({ locale }) }),
    onMutate: (locale) => {
      const prev = qc.getQueryData<MeResponse>(keys.me);
      if (prev) qc.setQueryData<MeResponse>(keys.me, { ...prev, user: { ...prev.user, locale } });
      return { prev };
    },
    onError: (_e, _l, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.me, ctx.prev);
    },
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

function useSetChurch() {
  const qc = useQueryClient();
  return (church: ChurchInfo) => {
    const prev = qc.getQueryData<MeResponse>(keys.me);
    if (prev) qc.setQueryData<MeResponse>(keys.me, { ...prev, church });
  };
}

export function useUpdateChurch() {
  const setChurch = useSetChurch();
  return useMutation({
    mutationFn: (input: UpdateChurchInput) =>
      apiFetch<ChurchInfo>('/church', { method: 'PATCH', ...json(input) }),
    onSuccess: setChurch,
  });
}

export function useUploadLogo() {
  const setChurch = useSetChurch();
  return useMutation({
    mutationFn: (file: Blob) =>
      apiFetch<ChurchInfo>('/church/logo', {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
    onSuccess: setChurch,
  });
}

export function useRemoveLogo() {
  const setChurch = useSetChurch();
  return useMutation({
    mutationFn: () => apiFetch<ChurchInfo>('/church/logo', { method: 'DELETE' }),
    onSuccess: setChurch,
  });
}

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
    mutationFn: (input: TemplateInput) =>
      apiFetch<{ id: number }>('/templates', send('POST', input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/templates/${id}`, send('DELETE')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function usePinnedEvents(enabled = true) {
  return useQuery({
    queryKey: ['events', 'pinned'],
    queryFn: () => apiFetch<EventSummary[]>('/events/pinned'),
    enabled,
  });
}

// ---------- treasury ----------

export function useTreasury(groupId: number) {
  return useQuery({
    queryKey: keys.treasury(groupId),
    queryFn: () => apiFetch<TreasurySummary>(`/groups/${groupId}/treasury`),
  });
}

/** Cash-book entries, newest first; `filter` is a comma list of kinds ("" = all). */
export interface LedgerFilter {
  member?: number;
  meeting?: number;
  from?: string;
  to?: string;
  q?: string;
}

const ledgerQuery = (f: LedgerFilter) =>
  Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`)
    .join('');

/** Every entry matching a filter (for the downloadable sheet). */
export const fetchAllTransactions = (groupId: number, kinds: string, f: LedgerFilter) =>
  apiFetch<TransactionPage>(`/groups/${groupId}/transactions?kind=${kinds}${ledgerQuery(f)}&all=1`);

export function useTransactions(
  groupId: number,
  filter: string,
  opts: LedgerFilter & { enabled?: boolean } = {},
) {
  const { enabled, ...rest } = opts;
  const extra = ledgerQuery(rest);
  return useInfiniteQuery({
    queryKey: keys.transactions(groupId, `${filter}${extra}`),
    enabled: enabled ?? true,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiFetch<TransactionPage>(
        `/groups/${groupId}/transactions?kind=${filter}${extra}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useDues(groupId: number, year: number) {
  return useQuery({
    queryKey: keys.dues(groupId, year),
    queryFn: () => apiFetch<DuesSheet>(`/groups/${groupId}/dues?year=${year}`),
  });
}

/** Everything under the group's treasury key (summary, lists, dues) is refreshed. */
function useInvalidateTreasury(groupId: number) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.treasury(groupId) });
}

export function useCreateTransaction(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      apiFetch<TransactionRow>(`/groups/${groupId}/transactions`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTransactionInput & { id: number }) =>
      apiFetch<TransactionRow>(`/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function usePayDues(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: (input: PayDuesInput) =>
      apiFetch<{ created: number[]; skipped: string[] }>(`/groups/${groupId}/dues`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useSetDuesExempt(groupId: number) {
  const invalidate = useInvalidateTreasury(groupId);
  return useMutation({
    mutationFn: (input: { userId: number; exempt: boolean }) =>
      apiFetch(`/groups/${groupId}/dues/exempt`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useTreasurySettings(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TreasurySettingsInput) =>
      apiFetch<TreasurySummary>(`/groups/${groupId}/treasury`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      qc.setQueryData(keys.treasury(groupId), data);
      void qc.invalidateQueries({ queryKey: keys.treasury(groupId) });
    },
  });
}

/** Uploads an already-resized image; returns its id for attaching. */
export function useUploadMedia(groupId: number, kind: 'receipt' | 'event' = 'receipt') {
  return useMutation({
    mutationFn: (file: Blob) =>
      apiFetch<{ id: number; url: string }>(`/groups/${groupId}/media?kind=${kind}`, {
        method: 'POST',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
  });
}

export function useMyFinance(enabled = true) {
  return useQuery({
    queryKey: keys.myFinance,
    queryFn: () => apiFetch<MyFinanceGroup[]>('/me/finance'),
    enabled,
  });
}

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

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

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

// ---------- reports ----------

/** A report period: a whole year, a month ("YYYY-MM") or from..to (local dates). */
export type ReportPeriod = { from: string; to: string };
const periodQuery = (p: ReportPeriod) => `from=${p.from}&to=${p.to}`;
export const fetchTreasuryExport = (groupId: number, p: ReportPeriod) =>
  apiFetch<TreasuryExport>(`/groups/${groupId}/treasury/export?${periodQuery(p)}`);
export const fetchDues = (groupId: number, year: number) =>
  apiFetch<DuesSheet>(`/groups/${groupId}/dues?year=${year}`);
/** The statistics screen: totals, people, meetings and events of a period. */
export function useStatistics(groupId: number, p: ReportPeriod, enabled = true) {
  return useQuery({
    queryKey: ['groups', groupId, 'statistics', p.from, p.to],
    queryFn: () => apiFetch<GroupStatistics>(`/groups/${groupId}/statistics?${periodQuery(p)}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export const fetchAttendanceExport = (groupId: number, p: ReportPeriod) =>
  apiFetch<AttendanceExport>(`/groups/${groupId}/attendance/export?${periodQuery(p)}`);

/** The bot sends a picture (PNG/JPEG) to the user's own chat, as a photo or as a file. */
export const sendPictureToChat = (image: Blob, name: string, asFile = false) =>
  apiFetch<{ ok: true }>(`/me/photo?name=${encodeURIComponent(name)}${asFile ? '&as=file' : ''}`, {
    method: 'POST',
    body: image,
    headers: { 'content-type': image.type || 'image/png' },
  });

/** The bot sends the file to the user's own chat. */
export const sendDocumentToChat = (file: Blob, name: string) =>
  apiFetch<{ ok: true }>(`/me/document?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': 'application/octet-stream' },
  });

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
