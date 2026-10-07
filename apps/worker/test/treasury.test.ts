import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  localDate,
  periodOf,
  type DuesSheet,
  type GroupDetail,
  type MemberRow,
  type MyFinanceGroup,
  type TransactionPage,
  type TransactionRow,
  type TreasurySummary,
} from '@church/shared';
import {
  ADMIN,
  api,
  apiJson,
  fakeUser,
  mockTelegram,
  pressButton,
  sendText,
  type FakeTgUser,
} from './helpers';

beforeEach(() => {
  mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

// 1×1 transparent PNG
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (ch) => ch.charCodeAt(0),
);

const today = () => localDate(Date.now(), 'Europe/Riga');
const thisPeriod = () => periodOf(today());

async function createGroup(name: string) {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  const detail = await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
  const inviteCode = new URL(detail.inviteLink!).searchParams.get('start')!.slice(2);
  return { id, inviteCode };
}

async function addOffline(groupId: number, firstName: string) {
  const { userId } = await apiJson<{ userId: number }>(`/api/groups/${groupId}/members`, {
    method: 'POST',
    user: ADMIN,
    json: { firstName },
  });
  return userId;
}

async function joinAndApprove(user: FakeTgUser, group: { id: number; inviteCode: string }) {
  await sendText(user, `/start g_${group.inviteCode}`);
  await pressButton(user, `pv:g_${group.inviteCode}`);
  const rows = await apiJson<MemberRow[]>(`/api/groups/${group.id}/members`, { user: ADMIN });
  const row = rows.find((m) => m.firstName === user.first_name)!;
  await apiJson(`/api/memberships/${row.membershipId}`, {
    method: 'PATCH',
    user: ADMIN,
    json: { status: 'active' },
  });
  return row.userId;
}

const post = <T>(path: string, json: unknown, user = ADMIN) =>
  apiJson<T>(path, { method: 'POST', user, json });

describe('treasury: cash book', () => {
  it('records income, expenses and donations; balance and stats add up', async () => {
    const g = await createGroup('Касса');
    const donor = await addOffline(g.id, 'Павел');
    await post(`/api/groups/${g.id}/transactions`, {
      kind: 'income',
      amountCents: 10_000,
      occurredOn: today(),
      category: 'collection',
    });
    await post(`/api/groups/${g.id}/transactions`, {
      kind: 'expense',
      amountCents: 2_550,
      occurredOn: today(),
      category: 'food',
      note: 'Пицца',
    });
    const gift = await post<TransactionRow>(`/api/groups/${g.id}/transactions`, {
      kind: 'donation',
      amountCents: 2_000,
      occurredOn: today(),
      memberUserId: donor,
    });
    expect(gift.member).toMatchObject({ id: donor, firstName: 'Павел' });

    const s = await apiJson<TreasurySummary>(`/api/groups/${g.id}/treasury`, { user: ADMIN });
    expect(s.balanceCents).toBe(10_000 - 2_550 + 2_000);
    expect(s.month).toMatchObject({ incomeCents: 12_000, expenseCents: 2_550 });
    expect(s.series).toHaveLength(12);
    expect(s.expenseByCategory).toEqual([{ category: 'food', cents: 2_550 }]);
    expect(s.donors).toEqual([
      { member: { id: donor, firstName: 'Павел', lastName: null }, cents: 2_000, count: 1 },
    ]);

    const page = await apiJson<TransactionPage>(`/api/groups/${g.id}/transactions`, {
      user: ADMIN,
    });
    expect(page.items.map((t) => t.kind)).toEqual(['donation', 'expense', 'income']);
    const onlyExpenses = await apiJson<TransactionPage>(
      `/api/groups/${g.id}/transactions?kind=expense`,
      { user: ADMIN },
    );
    expect(onlyExpenses.items).toHaveLength(1);
  });

  it('voiding removes an entry from the balance but keeps it auditable', async () => {
    const g = await createGroup('Отмена');
    const tx = await post<TransactionRow>(`/api/groups/${g.id}/transactions`, {
      kind: 'expense',
      amountCents: 999,
      occurredOn: today(),
    });
    const voided = await apiJson<TransactionRow>(`/api/transactions/${tx.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { voided: true },
    });
    expect(voided.voided).toBe(true);
    const s = await apiJson<TreasurySummary>(`/api/groups/${g.id}/treasury`, { user: ADMIN });
    expect(s.balanceCents).toBe(0);
    const again = await api(`/api/transactions/${tx.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { voided: true },
    });
    expect(again.status).toBe(409);
  });

  it('validates input and rejects donors from other groups', async () => {
    const g = await createGroup('Проверка');
    const other = await createGroup('Чужая');
    const stranger = await addOffline(other.id, 'Чужой');
    const bad = (json: unknown) =>
      api(`/api/groups/${g.id}/transactions`, { method: 'POST', user: ADMIN, json });
    expect((await bad({ kind: 'income', amountCents: 0, occurredOn: today() })).status).toBe(400);
    expect((await bad({ kind: 'dues', amountCents: 500, occurredOn: today() })).status).toBe(400);
    expect(
      (
        await bad({
          kind: 'donation',
          amountCents: 500,
          occurredOn: today(),
          memberUserId: stranger,
        })
      ).status,
    ).toBe(400);
  });

  it('only leaders and admins can see or change the treasury', async () => {
    const g = await createGroup('Закрытая');
    const member = fakeUser('Участник');
    await joinAndApprove(member, g);
    expect((await api(`/api/groups/${g.id}/treasury`, { user: member })).status).toBe(403);
    expect(
      (
        await api(`/api/groups/${g.id}/transactions`, {
          method: 'POST',
          user: member,
          json: { kind: 'income', amountCents: 100, occurredOn: today() },
        })
      ).status,
    ).toBe(403);
  });
});

describe('treasury: receipts', () => {
  it('uploads a receipt, attaches it and serves it through a signed URL only', async () => {
    const g = await createGroup('Чеки');
    const up = await api(`/api/groups/${g.id}/media`, { method: 'POST', user: ADMIN, body: PNG });
    expect(up.status).toBe(201);
    const { id } = (await up.json()) as { id: number };
    const tx = await post<TransactionRow>(`/api/groups/${g.id}/transactions`, {
      kind: 'expense',
      amountCents: 1_234,
      occurredOn: today(),
      receiptMediaId: id,
    });
    expect(tx.receiptUrl).toMatch(new RegExp(`^/media/m/${id}\\?e=\\d+&s=[0-9a-f]{32}$`));
    const img = await api(tx.receiptUrl!);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');

    expect((await api(`/media/m/${id}`)).status).toBe(403);
    expect((await api(tx.receiptUrl!.replace(/s=[0-9a-f]{4}/, 's=0000'))).status).toBe(403);
    const other = await createGroup('Другая');
    const foreign = await api(`/api/groups/${other.id}/transactions`, {
      method: 'POST',
      user: ADMIN,
      json: { kind: 'expense', amountCents: 1, occurredOn: today(), receiptMediaId: id },
    });
    expect(foreign.status).toBe(400);
  });

  it('rejects files that are not images', async () => {
    const g = await createGroup('Не картинка');
    const res = await api(`/api/groups/${g.id}/media`, {
      method: 'POST',
      user: ADMIN,
      body: new TextEncoder().encode('<svg onload=alert(1)>'),
    });
    expect(res.status).toBe(415);
  });
});

describe('treasury: monthly dues', () => {
  it('marks months paid, skips double payments, and fills the sheet', async () => {
    const g = await createGroup('Взносы');
    const anna = await addOffline(g.id, 'Анна');
    const boris = await addOffline(g.id, 'Борис');
    const now = thisPeriod();
    const year = Number(now.slice(0, 4));

    const r1 = await post<{ created: number[]; skipped: string[] }>(`/api/groups/${g.id}/dues`, {
      userId: anna,
      periods: [now],
    });
    expect(r1.created).toHaveLength(1);
    const r2 = await post<{ created: number[]; skipped: string[] }>(`/api/groups/${g.id}/dues`, {
      userId: anna,
      periods: [now],
    });
    expect(r2).toEqual({ created: [], skipped: [now] });

    const sheet = await apiJson<DuesSheet>(`/api/groups/${g.id}/dues?year=${year}`, {
      user: ADMIN,
    });
    expect(sheet.feeCents).toBe(500);
    expect(sheet.periods).toHaveLength(12);
    const annaRow = sheet.rows.find((r) => r.member.id === anna)!;
    const borisRow = sheet.rows.find((r) => r.member.id === boris)!;
    const idx = sheet.periods.indexOf(now);
    expect(annaRow.cells[idx]).toEqual({ period: now, paidCents: 500, state: 'paid' });
    expect(borisRow.cells[idx]!.state).toBe('unpaid');
    expect(borisRow.owedMonths).toBe(1); // joined this month
    expect(sheet.totals[idx]).toBe(500);

    const s = await apiJson<TreasurySummary>(`/api/groups/${g.id}/treasury`, { user: ADMIN });
    expect(s.dues).toEqual({ period: now, payers: 2, paid: 1, collectedCents: 500 });
    expect(s.balanceCents).toBe(500);
  });

  it('fee changes and exemptions are reflected; partial payments show as partial', async () => {
    const g = await createGroup('Настройки взносов');
    const vera = await addOffline(g.id, 'Вера');
    const gleb = await addOffline(g.id, 'Глеб');
    const now = thisPeriod();
    await apiJson(`/api/groups/${g.id}/treasury`, {
      method: 'PATCH',
      user: ADMIN,
      json: { monthlyFeeCents: 1_000 },
    });
    await post(`/api/groups/${g.id}/dues`, { userId: vera, periods: [now], amountCents: 400 });
    await apiJson(`/api/groups/${g.id}/dues/exempt`, {
      method: 'PUT',
      user: ADMIN,
      json: { userId: gleb, exempt: true },
    });
    const sheet = await apiJson<DuesSheet>(`/api/groups/${g.id}/dues`, { user: ADMIN });
    const idx = sheet.periods.indexOf(now);
    expect(sheet.feeCents).toBe(1_000);
    expect(sheet.rows.find((r) => r.member.id === vera)!.cells[idx]!.state).toBe('partial');
    const glebRow = sheet.rows.find((r) => r.member.id === gleb)!;
    expect(glebRow).toMatchObject({ exempt: true, owedMonths: 0 });
    expect(glebRow.cells[idx]!.state).toBe('none');
  });

  it('can pay several months ahead at once', async () => {
    const g = await createGroup('Вперёд');
    const dina = await addOffline(g.id, 'Дина');
    const now = thisPeriod();
    const next = (p: string, n: number) => {
      const [y, m] = p.split('-').map(Number) as [number, number];
      const i = y * 12 + m - 1 + n;
      return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    };
    const res = await post<{ created: number[] }>(`/api/groups/${g.id}/dues`, {
      userId: dina,
      periods: [now, next(now, 1), next(now, 2)],
    });
    expect(res.created).toHaveLength(3);
    const s = await apiJson<TreasurySummary>(`/api/groups/${g.id}/treasury`, { user: ADMIN });
    expect(s.balanceCents).toBe(1_500);
  });

  it('a member sees only their own dues and donations', async () => {
    const g = await createGroup('Мои взносы');
    const member = fakeUser('Ева');
    const userId = await joinAndApprove(member, g);
    await post(`/api/groups/${g.id}/dues`, { userId, periods: [thisPeriod()] });
    await post(`/api/groups/${g.id}/transactions`, {
      kind: 'donation',
      amountCents: 700,
      occurredOn: today(),
      memberUserId: userId,
    });
    const mine = await apiJson<MyFinanceGroup[]>('/api/me/finance', { user: member });
    const row = mine.find((m) => m.groupId === g.id)!;
    expect(row).toMatchObject({
      paidPeriods: [thisPeriod()],
      owedPeriods: [],
      donatedCents: 700,
      balanceCents: null,
    });

    await apiJson(`/api/groups/${g.id}/treasury`, {
      method: 'PATCH',
      user: ADMIN,
      json: { membersSeeTreasury: true },
    });
    const after = await apiJson<MyFinanceGroup[]>('/api/me/finance', { user: member });
    expect(after.find((m) => m.groupId === g.id)!.balanceCents).toBe(1_200);
  });
});

describe('treasury: set balance and wipe', () => {
  it('sets the balance with one correction entry; only church admins can wipe, with the name', async () => {
    const g = await createGroup('Касса тест');
    await post(`/api/groups/${g.id}/transactions`, {
      kind: 'income',
      amountCents: 5000,
      occurredOn: today(),
    });
    const after = await post<TreasurySummary>(`/api/groups/${g.id}/treasury/balance`, {
      balanceCents: 12000,
      note: 'Пересчитали наличные',
    });
    expect(after.balanceCents).toBe(12000);
    const lower = await post<TreasurySummary>(`/api/groups/${g.id}/treasury/balance`, {
      balanceCents: 2000,
    });
    expect(lower.balanceCents).toBe(2000);

    const wrong = await api(`/api/groups/${g.id}/treasury`, {
      method: 'DELETE',
      user: ADMIN,
      json: { confirmName: 'не то' },
    });
    expect(wrong.status).toBe(400);
    const wiped = await apiJson<TreasurySummary>(`/api/groups/${g.id}/treasury`, {
      method: 'DELETE',
      user: ADMIN,
      json: { confirmName: 'касса тест' },
    });
    expect(wiped.balanceCents).toBe(0);
  });
});
