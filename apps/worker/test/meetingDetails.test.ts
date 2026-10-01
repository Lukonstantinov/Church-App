import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  addDays,
  localDate,
  type GroupDetail,
  type MeetingDetail,
  type MeetingRow,
  type MemberRow,
  type ScheduleRow,
  type TransactionPage,
} from '@church/shared';
import { getDb } from '../src/db/client';
import { generateMeetings } from '../src/lib/meetings';
import {
  ADMIN,
  api,
  apiJson,
  fakeUser,
  mockTelegram,
  pressButton,
  sendText,
  type FakeTgUser,
  type TgCall,
} from './helpers';

const TZ = 'Europe/Riga';
let calls: TgCall[];
beforeEach(() => {
  calls = mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

async function createEnv(name: string) {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  const d = await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
  return { id, inviteCode: new URL(d.inviteLink!).searchParams.get('start')!.slice(2) };
}

async function join(user: FakeTgUser, g: { id: number; inviteCode: string }) {
  await sendText(user, `/start g_${g.inviteCode}`);
  await pressButton(user, `pv:g_${g.inviteCode}`);
  const row = (await apiJson<MemberRow[]>(`/api/groups/${g.id}/members`, { user: ADMIN })).find(
    (m) => m.firstName === user.first_name,
  )!;
  await apiJson(`/api/memberships/${row.membershipId}`, {
    method: 'PATCH',
    user: ADMIN,
    json: { status: 'active' },
  });
  return row.userId;
}

const sentTo = async (chatId: number, text: string) => {
  for (let i = 0; i < 20; i++) {
    const hit = calls.find(
      (c) =>
        c.method === 'sendMessage' &&
        c.body.chat_id === chatId &&
        String(c.body.text).includes(text),
    );
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  return undefined;
};

const patch = (id: number, json: unknown, user: FakeTgUser = ADMIN) =>
  api(`/api/meetings/${id}`, { method: 'PATCH', user, json });

describe('meeting details', () => {
  it('leader and snack person get messages; the leader fills in the rest; members see only basics', async () => {
    const g = await createEnv('Встречи с ведущим');
    const lead = fakeUser('Ведущий');
    const snack = fakeUser('Перекус');
    const plain = fakeUser('Просто');
    const leadId = await join(lead, g);
    const snackId = await join(snack, g);
    await join(plain, g);
    const date = addDays(localDate(new Date(), TZ), 7);
    const meeting = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '19:00', durationMin: 120, title: 'Молодёжка' },
    });

    const assigned = await patch(meeting.id, { leaderUserId: leadId });
    expect(((await assigned.json()) as { notified: string[] }).notified).toEqual(['leader']);
    expect(await sentTo(lead.id, 'Вы ведёте встречу')).toBeDefined();

    // The leader may fill in place, topic, type and snacks, but not move or reassign.
    const own = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: lead });
    expect(own).toMatchObject({ canEdit: true, canManage: false, attendance: [] });
    const filled = await patch(
      meeting.id,
      { location: 'Зал 2', topic: 'Вера и дела', kind: 'worship', snackUserId: snackId },
      lead,
    );
    expect(filled.status).toBe(200);
    expect(await sentTo(snack.id, '15,00')).toBeDefined();
    expect((await patch(meeting.id, { leaderUserId: snackId }, lead)).status).toBe(403);
    expect((await patch(meeting.id, { date }, lead)).status).toBe(403);
    expect((await patch(meeting.id, { topic: 'x' }, plain)).status).toBe(403);

    const seen = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: plain });
    expect(seen).toMatchObject({
      location: 'Зал 2',
      topic: 'Вера и дела',
      kind: 'worship',
      canEdit: false,
      attendance: null,
      expenses: null,
      budgetCents: null,
    });
    expect(seen.leader).toMatchObject({ id: leadId });
    expect((await api(`/api/meetings/${meeting.id}`, { user: fakeUser('Чужой') })).status).toBe(
      404,
    );

    // An expense recorded for the meeting shows under it and filters the cash book.
    await apiJson(`/api/groups/${g.id}/transactions`, {
      method: 'POST',
      user: ADMIN,
      json: {
        kind: 'expense',
        amountCents: 1240,
        occurredOn: date,
        category: 'food',
        note: 'Пицца и сок',
        meetingId: meeting.id,
      },
    });
    const full = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: ADMIN });
    expect(full.expenses).toHaveLength(1);
    expect(full.defaultBudgetCents).toBe(1500);
    const byMeeting = await apiJson<TransactionPage>(
      `/api/groups/${g.id}/transactions?meeting=${meeting.id}`,
      { user: ADMIN },
    );
    expect(byMeeting.items).toHaveLength(1);
    expect(byMeeting.items[0]!.meeting).toMatchObject({ id: meeting.id, title: 'Молодёжка' });
    const byText = await apiJson<TransactionPage>(
      `/api/groups/${g.id}/transactions?q=${encodeURIComponent('пицца')}&all=1`,
      { user: ADMIN },
    );
    expect(byText.items).toHaveLength(1);
  });

  it('a moved meeting keeps its schedule slot, so it is not created again', async () => {
    const g = await createEnv('Перенос');
    const schedule = await apiJson<ScheduleRow>(`/api/groups/${g.id}/schedules`, {
      method: 'POST',
      user: ADMIN,
      json: { weekday: 2, startTime: '19:00', durationMin: 120, title: 'Среда' },
    });
    await env.DB.prepare(
      "UPDATE meeting_schedules SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind(schedule.id)
      .run();
    const db = getDb(env.DB);
    await generateMeetings(db, TZ, { groupId: g.id });
    const before = await apiJson<MeetingRow[]>(`/api/groups/${g.id}/meetings?limit=100`, {
      user: ADMIN,
    });
    expect(before.length).toBeGreaterThanOrEqual(12); // about three months ahead
    const first = before[0]!;
    const moved = addDays(localDate(first.startsAt, TZ), 1);
    expect((await patch(first.id, { date: moved, startTime: '18:30' })).status).toBe(200);
    await generateMeetings(db, TZ, { groupId: g.id });
    const after = await apiJson<MeetingRow[]>(`/api/groups/${g.id}/meetings?limit=100`, {
      user: ADMIN,
    });
    expect(after).toHaveLength(before.length);
    const again = after.find((m) => m.id === first.id)!;
    expect(localDate(again.startsAt, TZ)).toBe(moved);
  });
});
