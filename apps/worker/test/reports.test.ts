import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  localDate,
  type AttendanceExport,
  type GroupDetail,
  type MeetingRow,
  type TreasuryExport,
} from '@church/shared';
import { ADMIN, api, apiJson, callsTo, fakeUser, mockTelegram, type TgCall } from './helpers';

let calls: TgCall[];
beforeEach(() => {
  calls = mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

async function createGroup(name: string) {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  return (await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN })).id;
}

const post = <T>(path: string, json: unknown) =>
  apiJson<T>(path, { method: 'POST', user: ADMIN, json });

describe('report data', () => {
  it('treasury export: the year’s entries with opening and closing balance', async () => {
    const g = await createGroup('Отчёт');
    const year = new Date().getUTCFullYear();
    await post(`/api/groups/${g}/transactions`, {
      kind: 'income',
      amountCents: 1000,
      occurredOn: `${year - 1}-12-31`,
    });
    await post(`/api/groups/${g}/transactions`, {
      kind: 'expense',
      amountCents: 300,
      occurredOn: `${year}-02-01`,
    });
    await post(`/api/groups/${g}/transactions`, {
      kind: 'income',
      amountCents: 500,
      occurredOn: `${year}-03-01`,
    });
    const r = await apiJson<TreasuryExport>(`/api/groups/${g}/treasury/export?year=${year}`, {
      user: ADMIN,
    });
    expect(r).toMatchObject({ year, openingCents: 1000, closingCents: 1200, currency: 'EUR' });
    expect(r.transactions.map((t) => t.amountCents)).toEqual([300, 500]);
    expect(
      (await api(`/api/groups/${g}/treasury/export`, { user: fakeUser('Посторонний') })).status,
    ).toBe(403);
  });

  it('attendance export: members × held meetings', async () => {
    const g = await createGroup('Посещаемость отчёт');
    const { userId } = await apiJson<{ userId: number }>(`/api/groups/${g}/members`, {
      method: 'POST',
      user: ADMIN,
      json: { firstName: 'Олег' },
    });
    const today = localDate(Date.now(), 'Europe/Riga');
    const m = await post<MeetingRow>(`/api/groups/${g}/meetings`, {
      date: today,
      startTime: '00:00',
      title: 'Встреча',
      durationMin: 15,
    });
    await apiJson(`/api/meetings/${m.id}/roll`, {
      method: 'PUT',
      user: ADMIN,
      json: { entries: [{ userId, status: 'late' }], guestCount: 2 },
    });
    const r = await apiJson<AttendanceExport>(
      `/api/groups/${g}/attendance/export?year=${today.slice(0, 4)}`,
      { user: ADMIN },
    );
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0]).toMatchObject({ title: 'Встреча', guestCount: 2 });
    expect(r.rows).toEqual([
      { member: { id: userId, firstName: 'Олег', lastName: null }, statuses: ['late'] },
    ]);
  });
});

describe('sending a report to the chat', () => {
  const pdf = new TextEncoder().encode('%PDF-1.4\n%fake\n');
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const send = (name: string, body: Uint8Array) =>
    api(`/api/me/document?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      user: ADMIN,
      body,
    });

  it('the bot sends a PDF or XLSX to the requester', async () => {
    expect((await send('Касса 2026 — Молодёжь.pdf', pdf)).status).toBe(200);
    expect((await send('Посещаемость 2026.xlsx', zip)).status).toBe(200);
    expect(callsTo(calls, 'sendDocument')).toHaveLength(2);
  });

  it('rejects other files and odd names', async () => {
    expect((await send('x.pdf', zip)).status).toBe(415);
    expect((await send('x.exe', pdf)).status).toBe(400);
    expect((await send('../../etc.pdf', pdf)).status).toBe(400);
    expect(callsTo(calls, 'sendDocument')).toHaveLength(0);
  });
});
