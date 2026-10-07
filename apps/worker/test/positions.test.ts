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
    // Deleting a position people hold: they become plain members (the default position).
    const after = await apiJson<PositionRow[]>(`/api/positions/${media.id}`, {
      method: 'DELETE',
      user: ADMIN,
    });
    expect(after.map((p) => p.name)).not.toContain('Медиа');
    const me = (await apiJson<MemberRow[]>(`/api/groups/${g.id}/members`, { user: ADMIN })).find(
      (m) => m.membershipId === row.membershipId,
    )!;
    expect(me).toMatchObject({ positionId: def.id, role: 'member' });
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

  it('with the design lock on, only designers change the look of a meeting', async () => {
    const g = await createEnv('Дизайн');
    const made = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Дизайнер', permissions: ['design'] },
    });
    const withManager = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Организатор', permissions: ['meetings.manage'] },
    });
    const designer = fakeUser('Художник');
    const manager = fakeUser('Организатор');
    await assign(
      (await join(designer, g)).membershipId,
      made.find((p) => p.name === 'Дизайнер')!.id,
    );
    await assign(
      (await join(manager, g)).membershipId,
      withManager.find((p) => p.name === 'Организатор')!.id,
    );
    const m = await apiJson<{ id: number }>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date: '2031-03-01', startTime: '18:00', durationMin: 60, title: 'Встреча' },
    });
    const patch = (user: FakeTgUser, json: unknown) =>
      api(`/api/meetings/${m.id}`, { method: 'PATCH', user, json });

    // Lock off: the manager may still change the look.
    expect((await patch(manager, { motion: 'stars' })).status).toBe(200);
    await apiJson('/api/church', { method: 'PATCH', user: ADMIN, json: { designLock: true } });
    try {
      expect((await patch(manager, { motion: 'waves' })).status).toBe(403);
      // Sending the same look again (as forms do) with other changes is fine.
      expect((await patch(manager, { title: 'Новая', motion: 'stars' })).status).toBe(200);
      // The designer changes the look, but not the meeting itself.
      expect((await patch(designer, { motion: 'bokeh' })).status).toBe(200);
      expect((await patch(designer, { title: 'Чужая' })).status).toBe(403);
      const seen = await apiJson<{ canDesign: boolean; motion: string }>(`/api/meetings/${m.id}`, {
        user: manager,
      });
      expect(seen).toMatchObject({ canDesign: false, motion: 'bokeh' });

      // A template's animation shows on meetings using it, and follows its changes.
      const tpl = { name: 'Звёзды', brandColor: null, pattern: null, motion: 'rays' };
      const { id: tplId } = await apiJson<{ id: number }>('/api/templates', {
        method: 'POST',
        user: designer,
        json: tpl,
      });
      expect((await patch(designer, { templateId: tplId, motion: null })).status).toBe(200);
      const motionNow = async () =>
        (await apiJson<{ motion: string }>(`/api/meetings/${m.id}`, { user: manager })).motion;
      expect(await motionNow()).toBe('rays');
      await apiJson(`/api/templates/${tplId}`, {
        method: 'PUT',
        user: designer,
        json: { ...tpl, motion: 'waves' },
      });
      expect(await motionNow()).toBe('waves');
      // Someone else's template can't be changed.
      expect(
        (await api(`/api/templates/${tplId}`, { method: 'PUT', user: manager, json: tpl })).status,
      ).toBe(403);
    } finally {
      await apiJson('/api/church', { method: 'PATCH', user: ADMIN, json: { designLock: false } });
    }
  });

  it('the Design studio saves how page parts look, for designers and admins only', async () => {
    const g = await createEnv('Студия');
    const made = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Дизайнер', permissions: ['design'] },
    });
    const designer = fakeUser('Студиец');
    const member = fakeUser('Зритель');
    await assign(
      (await join(designer, g)).membershipId,
      made.find((p) => p.name === 'Дизайнер')!.id,
    );
    await join(member, g);
    const look = {
      screenLook: { actions: { motion: 'embers', surface: 'brand' }, tabbar: { surface: 'dark' } },
      animation: 'zoom',
      meetingMotion: 'snow',
    };
    const put = (user: FakeTgUser, json: unknown) =>
      api(`/api/groups/${g.id}/studio`, { method: 'PUT', user, json });
    expect((await put(member, look)).status).toBe(403);
    expect((await put(designer, look)).status).toBe(200);
    const mine = (await apiJson<GroupSummary[]>('/api/groups', { user: designer })).find(
      (x) => x.id === g.id,
    )!;
    expect(mine.screenLook).toEqual(look.screenLook);
    expect(mine.animation).toBe('zoom');
    // Edges, fonts, tuning and icons are kept; a font that doesn't exist is refused.
    const rich = {
      screenLook: {
        posts: {
          edge: 'metal',
          font: 'playfair-display',
          tune: { speed: 2, size: 1.5, angle: 90, color: '#ff0000' },
          icon: { emoji: '🔥' },
          motion: 'iconorbit',
          layers: ['goo', 'fireflies'],
          textScale: 0.85,
          shine: 'glint',
        },
      },
    };
    expect((await put(designer, rich)).status).toBe(200);
    expect((await put(designer, { screenLook: { posts: { font: 'Comic Sans' } } })).status).toBe(
      400,
    );
    // An unknown part or animation is refused.
    expect((await put(designer, { screenLook: { roof: { motion: 'snow' } } })).status).toBe(400);
    // The church's main page: admins only.
    const church = { screenLook: { cards: { motion: 'aurora' } } };
    expect(
      (await api('/api/church/studio', { method: 'PUT', user: designer, json: church })).status,
    ).toBe(403);
    const saved = await apiJson<{ screenLook: unknown }>('/api/church/studio', {
      method: 'PUT',
      user: ADMIN,
      json: church,
    });
    expect(saved.screenLook).toEqual(church.screenLook);
    // One background for the whole app reaches every ministry.
    const bg = {
      source: 'color',
      colors: ['#112233'],
      strength: 0.4,
      texture: 'none',
      animation: 'none',
    };
    await apiJson('/api/church/studio', {
      method: 'PUT',
      user: ADMIN,
      json: { appBackground: bg, everywhere: true },
    });
    const after = (await apiJson<GroupSummary[]>('/api/groups', { user: ADMIN })).find(
      (x) => x.id === g.id,
    )!;
    expect(after.pageBackground).toMatchObject({ colors: ['#112233'] });
    await apiJson('/api/church/studio', {
      method: 'PUT',
      user: ADMIN,
      json: { appBackground: null, everywhere: true },
    });
    await apiJson('/api/church/studio', { method: 'PUT', user: ADMIN, json: { screenLook: {} } });
  });
});
