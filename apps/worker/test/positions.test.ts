import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PERMISSIONS,
  type GroupDetail,
  type GroupSummary,
  type MeResponse,
  type MemberRow,
  type PersonSearchRow,
  type PositionRow,
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

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (ch) => ch.charCodeAt(0),
);

async function createEnv(name: string) {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  const detail = await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
  return { id, inviteCode: new URL(detail.inviteLink!).searchParams.get('start')!.slice(2) };
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
  return row;
}

const positionsOf = (groupId: number, user = ADMIN) =>
  apiJson<PositionRow[]>(`/api/groups/${groupId}/positions`, { user });

async function assign(membershipId: number, positionId: number, user = ADMIN) {
  return api(`/api/memberships/${membershipId}`, {
    method: 'PATCH',
    user,
    json: { positionId },
  });
}

describe('positions', () => {
  it('new environments start with Leader (all rights) and Member (default, none)', async () => {
    const g = await createEnv('Прославление');
    const list = await positionsOf(g.id);
    expect(list.map((p) => [p.name, p.permissions.length, p.isDefault])).toEqual([
      ['Лидер', PERMISSIONS.length, false],
      ['Участник', 0, true],
    ]);
    const u = fakeUser('Новичок');
    await join(u, g);
    const me = await apiJson<MeResponse>('/api/me', { user: u });
    expect(me.memberships.find((m) => m.groupId === g.id)).toMatchObject({
      positionName: 'Участник',
      permissions: [],
    });
  });

  it('a custom "Treasurer" position can see and keep money, and nothing else', async () => {
    const g = await createEnv('Касса');
    const created = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Казначей', description: 'Ведёт кассу', permissions: ['money.manage'] },
    });
    const treasurer = created.find((p) => p.name === 'Казначей')!;
    // Implied rights are added automatically.
    expect(treasurer.permissions).toEqual(['people.view', 'money.view', 'money.manage']);

    const u = fakeUser('Кассир');
    const row = await join(u, g);
    expect((await assign(row.membershipId, treasurer.id)).status).toBe(200);

    expect((await api(`/api/groups/${g.id}/treasury`, { user: u })).status).toBe(200);
    const tx = await api(`/api/groups/${g.id}/transactions`, {
      method: 'POST',
      user: u,
      json: { kind: 'income', amountCents: 100, occurredOn: '2026-09-01' },
    });
    expect(tx.status).toBe(201);
    const ev = await api(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: u,
      json: { title: 'X', date: '2026-12-01', startTime: '10:00' },
    });
    expect(ev.status).toBe(403);
    const sched = await api(`/api/groups/${g.id}/schedules`, { user: u });
    expect(sched.status).toBe(403);

    const summary = (await apiJson<GroupSummary[]>('/api/groups', { user: u })).find(
      (x) => x.id === g.id,
    )!;
    expect(summary.myPermissions).toEqual(['people.view', 'money.view', 'money.manage']);
    expect(summary.positionName).toBe('Казначей');
  });

  it('prevents handing out rights one does not hold, and editing one’s own position', async () => {
    const g = await createEnv('Эскалация');
    const [posAdmin] = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Кадры', permissions: ['positions', 'people.manage'] },
    }).then((l) => l.filter((p) => p.name === 'Кадры'));
    const hr = fakeUser('Кадровик');
    const hrRow = await join(hr, g);
    await assign(hrRow.membershipId, posAdmin!.id);

    const tooMuch = await api(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: hr,
      json: { name: 'Хитрый', permissions: ['money.manage'] },
    });
    expect(tooMuch.status).toBe(403);
    const ok = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: hr,
      json: { name: 'Помощник', permissions: ['people.view'] },
    });
    const helper = ok.find((p) => p.name === 'Помощник')!;

    const leader = (await positionsOf(g.id)).find((p) => p.name === 'Лидер')!;
    const other = fakeUser('Другой');
    const otherRow = await join(other, g);
    expect((await assign(otherRow.membershipId, leader.id, hr)).status).toBe(403);
    expect((await assign(otherRow.membershipId, helper.id, hr)).status).toBe(200);
    expect((await assign(hrRow.membershipId, helper.id, hr)).status).toBe(403);

    const editLeader = await api(`/api/positions/${leader.id}`, {
      method: 'PATCH',
      user: hr,
      json: { name: 'Лидер', permissions: [] },
    });
    expect(editLeader.status).toBe(403);
  });

  it('positions in use or the default one cannot be deleted', async () => {
    const g = await createEnv('Удаление');
    const list = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Медиа', permissions: ['events.manage'] },
    });
    const media = list.find((p) => p.name === 'Медиа')!;
    const def = list.find((p) => p.isDefault)!;
    expect((await api(`/api/positions/${def.id}`, { method: 'DELETE', user: ADMIN })).status).toBe(
      409,
    );
    const u = fakeUser('Фотограф');
    const row = await join(u, g);
    await assign(row.membershipId, media.id);
    expect(
      (await api(`/api/positions/${media.id}`, { method: 'DELETE', user: ADMIN })).status,
    ).toBe(409);
    await assign(row.membershipId, def.id);
    const after = await apiJson<PositionRow[]>(`/api/positions/${media.id}`, {
      method: 'DELETE',
      user: ADMIN,
    });
    expect(after.map((p) => p.name)).not.toContain('Медиа');
  });

  it('switching the default position changes what new members get', async () => {
    const g = await createEnv('По умолчанию');
    const list = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Гость', permissions: [], isDefault: true },
    });
    expect(list.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['Гость']);
    const u = fakeUser('Гостья');
    await join(u, g);
    const me = await apiJson<MeResponse>('/api/me', { user: u });
    expect(me.memberships.find((m) => m.groupId === g.id)!.positionName).toBe('Гость');
  });
});

describe('adding people and environment look', () => {
  it('leaders find church people and add them directly', async () => {
    const a = await createEnv('Откуда');
    const b = await createEnv('Куда');
    const person = fakeUser('Зоя', { username: 'zoya_k' });
    await join(person, a);

    const found = await apiJson<PersonSearchRow[]>(`/api/groups/${b.id}/people-search?q=zoy`, {
      user: ADMIN,
    });
    // Case-insensitive for Cyrillic too.
    const cyr = await apiJson<PersonSearchRow[]>(
      `/api/groups/${b.id}/people-search?q=${encodeURIComponent('зО')}`,
      { user: ADMIN },
    );
    expect(cyr.some((p) => p.firstName === 'Зоя')).toBe(true);
    const zoya = found.find((p) => p.firstName === 'Зоя')!;
    expect(zoya).toMatchObject({ username: 'zoya_k', inGroup: false });

    const add = await api(`/api/groups/${b.id}/members/existing`, {
      method: 'POST',
      user: ADMIN,
      json: { userId: zoya.userId },
    });
    expect(add.status).toBe(201);
    const again = await api(`/api/groups/${b.id}/members/existing`, {
      method: 'POST',
      user: ADMIN,
      json: { userId: zoya.userId },
    });
    expect(again.status).toBe(409);
    const me = await apiJson<MeResponse>('/api/me', { user: person });
    expect(me.memberships.map((m) => m.groupId).sort()).toEqual([a.id, b.id].sort());

    const plain = fakeUser('Простой');
    await join(plain, b);
    expect((await api(`/api/groups/${b.id}/people-search?q=a`, { user: plain })).status).toBe(403);
  });

  it('each environment has its own theme and logo', async () => {
    const g = await createEnv('Цвета');
    const up = await api(`/api/groups/${g.id}/media?kind=event`, {
      method: 'POST',
      user: ADMIN,
      body: PNG,
    });
    const { id } = (await up.json()) as { id: number };
    await apiJson(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { brandColor: 'sunset', logoMediaId: id },
    });
    const s = (await apiJson<GroupSummary[]>('/api/groups', { user: ADMIN })).find(
      (x) => x.id === g.id,
    )!;
    expect(s.brandColor).toBe('sunset');
    expect(s.logoUrl).toBe(`/media/g/${g.id}/logo?v=${id}`);
    const img = await api(s.logoUrl!);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');

    await apiJson(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { brandColor: '#ff66aa' },
    });
    const bad = await api(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { brandColor: 'url(javascript:x)' },
    });
    expect(bad.status).toBe(400);
  });
});
