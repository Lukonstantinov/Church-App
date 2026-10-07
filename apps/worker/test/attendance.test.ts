import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  addDays,
  localDate,
  type GroupDetail,
  type GroupStats,
  type MeetingRow,
  type MemberDetail,
  type MyAttendanceResponse,
  type RollResponse,
  type ScheduleRow,
} from '@church/shared';
import { getDb } from '../src/db/client';
import { generateMeetings } from '../src/lib/meetings';
import { ADMIN, api, apiJson, fakeUser, mockTelegram, type FakeTgUser } from './helpers';

const TZ = 'Europe/Riga';

beforeEach(() => {
  mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

async function newGroup(name: string) {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  return id;
}

/** Adds offline members who "joined" `daysAgo` days ago. */
async function addMembers(groupId: number, names: string[], daysAgo = 60) {
  const ids: number[] = [];
  for (const firstName of names) {
    const r = await apiJson<{ userId: number; membershipId: number }>(
      `/api/groups/${groupId}/members`,
      {
        method: 'POST',
        user: ADMIN,
        json: { firstName },
      },
    );
    const joined = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    await env.DB.prepare('UPDATE memberships SET joined_at = ? WHERE id = ?')
      .bind(joined, r.membershipId)
      .run();
    ids.push(r.userId);
  }
  return ids;
}

/** One-off meeting on a past local date (default: 3 days ago), evening. */
async function pastMeeting(groupId: number, daysAgo = 3, title = 'Встреча') {
  const date = addDays(localDate(new Date(), TZ), -daysAgo);
  return apiJson<MeetingRow>(`/api/groups/${groupId}/meetings`, {
    method: 'POST',
    user: ADMIN,
    json: { date, startTime: '19:00', durationMin: 120, title },
  });
}

const roll = (meetingId: number, as: FakeTgUser = ADMIN) =>
  apiJson<RollResponse>(`/api/meetings/${meetingId}/roll`, { user: as });

describe('schedules → meetings', () => {
  it('generates meetings at the right local time across the DST change, idempotently', async () => {
    const group = await newGroup('DST');
    const schedule = await apiJson<ScheduleRow>(`/api/groups/${group}/schedules`, {
      method: 'POST',
      user: ADMIN,
      json: { weekday: 4, startTime: '19:00', durationMin: 120, title: 'Пятница' },
    });
    // Pretend the schedule existed long ago so nothing is skipped as "already ended".
    await env.DB.prepare(
      "UPDATE meeting_schedules SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind(schedule.id)
      .run();
    await env.DB.prepare('DELETE FROM meetings WHERE group_id = ?').bind(group).run();

    const db = getDb(env.DB);
    await generateMeetings(db, TZ, {
      now: new Date('2026-10-20T10:00:00Z'),
      horizonDays: 14,
      groupId: group,
    });
    await generateMeetings(db, TZ, {
      now: new Date('2026-10-20T10:00:00Z'),
      horizonDays: 14,
      groupId: group,
    });
    const rows = await env.DB.prepare(
      'SELECT starts_at FROM meetings WHERE group_id = ? ORDER BY starts_at',
    )
      .bind(group)
      .all<{ starts_at: string }>();
    // Fri 23 Oct is still summer time (UTC+3); Fri 30 Oct is winter time (UTC+2).
    expect(rows.results.map((r) => r.starts_at)).toEqual([
      '2026-10-23T16:00:00.000Z',
      '2026-10-30T17:00:00.000Z',
    ]);
  });

  it("shows new schedules' upcoming meetings straight away and removes them with the schedule", async () => {
    const group = await newGroup('Сразу');
    // Not today: a meeting already under way is kept when its schedule goes.
    const notToday = (new Date().getUTCDay() + 2) % 7;
    const schedule = await apiJson<ScheduleRow>(`/api/groups/${group}/schedules`, {
      method: 'POST',
      user: ADMIN,
      json: { weekday: notToday, startTime: '18:30', durationMin: 90, title: 'Среда' },
    });
    const upcoming = await apiJson<MeetingRow[]>(`/api/groups/${group}/meetings`, { user: ADMIN });
    expect(upcoming.length).toBeGreaterThanOrEqual(4);
    expect(upcoming.every((m) => m.title === 'Среда')).toBe(true);

    await apiJson(`/api/schedules/${schedule.id}`, { method: 'DELETE', user: ADMIN });
    expect(await apiJson<MeetingRow[]>(`/api/groups/${group}/meetings`, { user: ADMIN })).toEqual(
      [],
    );
  });

  it('rebuilds future meetings when the time changes', async () => {
    const group = await newGroup('Смена');
    const schedule = await apiJson<ScheduleRow>(`/api/groups/${group}/schedules`, {
      method: 'POST',
      user: ADMIN,
      json: { weekday: 4, startTime: '19:00', durationMin: 120, title: 'Пятница' },
    });
    await apiJson(`/api/schedules/${schedule.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { startTime: '20:00' },
    });
    const upcoming = await apiJson<MeetingRow[]>(`/api/groups/${group}/meetings`, { user: ADMIN });
    expect(upcoming.length).toBeGreaterThanOrEqual(4);
    for (const m of upcoming) {
      expect(new Date(m.startsAt).getUTCHours()).toBeGreaterThanOrEqual(17); // 20:00 Riga = 17:00/18:00 UTC
    }
  });

  it('validates schedule input and restricts it to leaders/admins', async () => {
    const group = await newGroup('Права');
    const bad = await api(`/api/groups/${group}/schedules`, {
      method: 'POST',
      user: ADMIN,
      json: { weekday: 9, startTime: '25:99', title: 'X' },
    });
    expect(bad.status).toBe(400);
    const outsider = await api(`/api/groups/${group}/schedules`, {
      method: 'POST',
      user: fakeUser('Чужой'),
      json: { weekday: 1, startTime: '10:00', title: 'X' },
    });
    expect(outsider.status).toBe(403);
  });
});

describe('roll call', () => {
  it('lists members, saves statuses (unmarked = absent) and reports counts', async () => {
    const group = await newGroup('Перекличка');
    const [anna, boris, vera, gleb] = await addMembers(group, ['Анна', 'Борис', 'Вера', 'Глеб']);
    const meeting = await pastMeeting(group);

    const before = await roll(meeting.id);
    expect(before.roster.map((r) => r.firstName)).toEqual(['Анна', 'Борис', 'Вера', 'Глеб']);
    expect(before.roster.every((r) => r.status === null)).toBe(true);
    expect(before.editable).toBe(true);

    const saved = await apiJson<MeetingRow>(`/api/meetings/${meeting.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: {
        entries: [
          { userId: anna!, status: 'present' },
          { userId: boris!, status: 'late' },
          { userId: vera!, status: 'excused' },
        ],
        guestCount: 2,
      },
    });
    expect(saved).toMatchObject({ status: 'done', guestCount: 2 });
    expect(saved.counts).toEqual({ present: 1, late: 1, excused: 1, absent: 1 }); // Глеб unmarked

    const after = await roll(meeting.id);
    expect(Object.fromEntries(after.roster.map((r) => [r.firstName, r.status]))).toEqual({
      Анна: 'present',
      Борис: 'late',
      Вера: 'excused',
      Глеб: 'absent',
    });
    void gleb;
  });

  it('rejects members outside the group, cancelled and not-yet-started meetings', async () => {
    const group = await newGroup('Ошибки');
    const [anna] = await addMembers(group, ['Анна']);
    const meeting = await pastMeeting(group);
    const stranger = await api(`/api/meetings/${meeting.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: { entries: [{ userId: 999_999, status: 'present' }], guestCount: 0 },
    });
    expect(stranger.status).toBe(400);

    await apiJson(`/api/meetings/${meeting.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { status: 'cancelled' },
    });
    const cancelled = await api(`/api/meetings/${meeting.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: { entries: [{ userId: anna!, status: 'present' }], guestCount: 0 },
    });
    expect(cancelled.status).toBe(409);
    await apiJson(`/api/meetings/${meeting.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { status: 'scheduled' },
    });

    const future = await apiJson<MeetingRow>(`/api/groups/${group}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date: addDays(localDate(new Date(), TZ), 5), startTime: '19:00', title: 'Будущая' },
    });
    const early = await api(`/api/meetings/${future.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: { entries: [], guestCount: 0 },
    });
    expect(early.status).toBe(409);
  });

  it('a finished meeting cannot be cancelled', async () => {
    const group = await newGroup('Итог');
    await addMembers(group, ['Анна']);
    const meeting = await pastMeeting(group);
    await apiJson(`/api/meetings/${meeting.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: { entries: [], guestCount: 0 },
    });
    const res = await api(`/api/meetings/${meeting.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { status: 'cancelled' },
    });
    expect(res.status).toBe(409);
  });

  it('keeps regular members out', async () => {
    const group = await newGroup('Закрыто');
    const meeting = await pastMeeting(group);
    const nobody = fakeUser('Никто');
    expect((await api(`/api/meetings/${meeting.id}/roll`, { user: nobody })).status).toBe(404);
    expect((await api(`/api/groups/${group}/meetings`, { user: nobody })).status).toBe(403);
    expect((await api(`/api/groups/${group}/stats`, { user: nobody })).status).toBe(403);
  });

  it('enforces the 14-day edit window for leaders but not admins', async () => {
    const group = await newGroup('Окно');
    const [anna] = await addMembers(group, ['Анна'], 90);
    const leader = fakeUser('Лидер', { username: 'window_leader' });
    await api('/api/me', { user: leader });
    const me = await apiJson<{ user: { id: number } }>('/api/me', { user: leader });
    await env.DB.prepare(
      "INSERT INTO memberships (user_id, group_id, status, role, joined_at) VALUES (?, ?, 'active', 'leader', ?)",
    )
      .bind(me.user.id, group, new Date(Date.now() - 90 * 86_400_000).toISOString())
      .run();

    const meeting = await pastMeeting(group, 20);
    // First roll call on an old meeting is allowed (backfilling history)…
    await apiJson(`/api/meetings/${meeting.id}/roll`, {
      method: 'PUT',
      user: leader,
      json: { entries: [{ userId: anna!, status: 'present' }], guestCount: 0 },
    });
    // …but editing it later is not, for a leader.
    const view = await roll(meeting.id, leader);
    expect(view.editable).toBe(false);
    const edit = await api(`/api/meetings/${meeting.id}/roll`, {
      method: 'PUT',
      user: leader,
      json: { entries: [{ userId: anna!, status: 'absent' }], guestCount: 0 },
    });
    expect(edit.status).toBe(403);
    const asAdmin = await api(`/api/meetings/${meeting.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: { entries: [{ userId: anna!, status: 'absent' }], guestCount: 0 },
    });
    expect(asAdmin.status).toBe(200);
  });

  it('includes a newcomer added on the day of the meeting', async () => {
    const group = await newGroup('Новичок');
    await addMembers(group, ['Анна']);
    const today = localDate(new Date(), TZ);
    const meeting = await apiJson<MeetingRow>(`/api/groups/${group}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date: today, startTime: '00:05', durationMin: 60, title: 'Сегодня' },
    });
    await addMembers(group, ['Новенький'], 0); // joined just now, after the meeting started
    const view = await roll(meeting.id);
    expect(view.roster.map((r) => r.firstName)).toContain('Новенький');
  });
});

describe('stats', () => {
  it('computes group averages, member percentages and absence streaks', async () => {
    const group = await newGroup('Статистика');
    const [anna, boris] = await addMembers(group, ['Анна', 'Борис']);
    // Oldest → newest: Анна present, present, absent, absent; Борис present ×4.
    const plan: [number, 'present' | 'absent'][] = [
      [12, 'present'],
      [9, 'present'],
      [6, 'absent'],
      [3, 'absent'],
    ];
    for (const [daysAgo, annaStatus] of plan) {
      const m = await pastMeeting(group, daysAgo);
      await apiJson(`/api/meetings/${m.id}/roll`, {
        method: 'PUT',
        user: ADMIN,
        json: {
          entries: [
            { userId: anna!, status: annaStatus },
            { userId: boris!, status: 'present' },
          ],
          guestCount: 0,
        },
      });
    }

    const stats = await apiJson<GroupStats>(`/api/groups/${group}/stats`, { user: ADMIN });
    expect(stats.activeMembers).toBe(2);
    expect(stats.series).toHaveLength(4);
    expect(stats.series.map((p) => p.attended)).toEqual([2, 2, 1, 1]); // oldest → newest
    expect(stats.averageRate).toBe(75);

    const detail = await apiJson<MemberDetail>(`/api/users/${anna}`, { user: ADMIN });
    expect(detail.attendance).toMatchObject([
      { groupId: group, percent: 50, attended: 2, counted: 4, streak: 2 },
    ]);
    expect(detail.attendance[0]!.recent.map((r) => r.status)).toEqual([
      'absent',
      'absent',
      'present',
      'present',
    ]);
  });

  it('lists finished-but-unrolled meetings as awaiting a roll call', async () => {
    const group = await newGroup('Ожидают');
    await addMembers(group, ['Анна']);
    const m = await pastMeeting(group, 2, 'Забыли отметить');
    const stats = await apiJson<GroupStats>(`/api/groups/${group}/stats`, { user: ADMIN });
    expect(stats.awaitingRoll.map((x) => x.id)).toContain(m.id);
  });

  it('gives members their own attendance and next meeting', async () => {
    const group = await newGroup('Мой профиль');
    await apiJson(`/api/groups/${group}/schedules`, {
      method: 'POST',
      user: ADMIN,
      json: { weekday: 4, startTime: '19:00', title: 'Пятница' },
    });
    const member = fakeUser('Мария', { username: 'maria_att' });
    await api('/api/me', { user: member });
    const me = await apiJson<{ user: { id: number } }>('/api/me', { user: member });
    await env.DB.prepare(
      "INSERT INTO memberships (user_id, group_id, status, role, joined_at) VALUES (?, ?, 'active', 'member', ?)",
    )
      .bind(me.user.id, group, new Date(Date.now() - 30 * 86_400_000).toISOString())
      .run();
    const m = await pastMeeting(group, 3);
    await apiJson(`/api/meetings/${m.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: { entries: [{ userId: me.user.id, status: 'late' }], guestCount: 0 },
    });

    const mine = await apiJson<MyAttendanceResponse>('/api/me/attendance', { user: member });
    expect(mine.groups).toHaveLength(1);
    expect(mine.groups[0]).toMatchObject({
      groupId: group,
      percent: 100,
      attended: 1,
      counted: 1,
      streak: 0,
    });
    expect(mine.groups[0]!.nextMeeting?.title).toBe('Пятница');
    void ({} as GroupDetail);
  });
});
