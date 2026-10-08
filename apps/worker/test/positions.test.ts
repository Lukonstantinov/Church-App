import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PERMISSIONS,
  type GroupDetail,
  type GroupSummary,
  type MeResponse,
  type EventDetail,
  type MeetingDetail,
  type MemberRow,
  type PersonSearchRow,
  type PositionRow,
} from '@church/shared';
import { env } from 'cloudflare:workers';
import { getDb } from '../src/db/client';
import { drainOutbox } from '../src/lib/outbox';
import { botApi } from '../src/lib/telegram';
import {
  ADMIN,
  api,
  apiJson,
  callsTo,
  fakeUser,
  mockTelegram,
  pressButton,
  sendText,
  type FakeTgUser,
  type TgCall,
} from './helpers';

let calls: TgCall[];
beforeEach(() => {
  calls = mockTelegram();
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
  it('designers test announcements on themselves and send them for approval; publishers send', async () => {
    const g = await createEnv('Публикация');
    const made = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Дизайнер', permissions: ['design'] },
    });
    const withPublish = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Медиа', permissions: ['announce'] },
    });
    const designer = fakeUser('Рисующий');
    const publisher = fakeUser('Публикующий');
    const member = fakeUser('Читающий');
    await assign(
      (await join(designer, g)).membershipId,
      made.find((p) => p.name === 'Дизайнер')!.id,
    );
    await assign(
      (await join(publisher, g)).membershipId,
      withPublish.find((p) => p.name === 'Медиа')!.id,
    );
    await join(member, g);
    const m = await apiJson<{ id: number }>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date: '2031-04-01', startTime: '18:00', durationMin: 60, title: 'Вечер' },
    });
    const drain = () => drainOutbox(getDb(env.DB), botApi(env), { limit: 100 });
    const texts = (chatId: number) =>
      [...callsTo(calls, 'sendMessage', chatId), ...callsTo(calls, 'sendPhoto', chatId)].map((c) =>
        String(c.body.text ?? c.body.caption ?? ''),
      );

    const seen = await apiJson<MeetingDetail>(`/api/meetings/${m.id}`, { user: designer });
    expect(seen).toMatchObject({ canPrepare: true, canPublish: false, publishRequest: null });
    const body = { notice: 'announce', text: 'Приходите на вечер!' };
    // A designer may not send it to everyone, and a plain member may not even test it.
    expect(
      (await api(`/api/meetings/${m.id}/announce`, { method: 'POST', user: designer, json: body }))
        .status,
    ).toBe(403);
    expect(
      (
        await api(`/api/meetings/${m.id}/announce/test`, {
          method: 'POST',
          user: member,
          json: body,
        })
      ).status,
    ).toBe(403);

    // The test goes only to the designer, marked as a test.
    const test = await apiJson<{ sent: number }>(`/api/meetings/${m.id}/announce/test`, {
      method: 'POST',
      user: designer,
      json: body,
    });
    expect(test.sent).toBe(1);
    await drain();
    expect(texts(designer.id).some((x) => x.includes('🧪') && x.includes('Приходите'))).toBe(true);
    expect(texts(member.id).some((x) => x.includes('Приходите'))).toBe(false);

    // Sent for approval: the publisher gets it with Send / Decline buttons.
    const req = await apiJson<{ id: number; asked: number }>(
      `/api/meetings/${m.id}/announce/request`,
      { method: 'POST', user: designer, json: body },
    );
    expect(req.asked).toBeGreaterThan(0);
    await drain();
    const card = callsTo(calls, 'sendMessage', publisher.id).find((c) =>
      JSON.stringify(c.body.reply_markup ?? {}).includes(`pq:s:${req.id}`),
    );
    expect(card).toBeTruthy();
    const pending = await apiJson<MeetingDetail>(`/api/meetings/${m.id}`, { user: publisher });
    expect(pending.canPublish).toBe(true);
    expect(pending.publishRequest).toMatchObject({ id: req.id, text: 'Приходите на вечер!' });

    // A member can't decide; the publisher sends it from the bot, once.
    expect(
      (await api(`/api/publish-requests/${req.id}/send`, { method: 'POST', user: member })).status,
    ).toBe(403);
    await pressButton(publisher, `pq:s:${req.id}`);
    await drain();
    await pressButton(publisher, `pq:s:${req.id}`);
    await drain();
    expect(texts(member.id).filter((x) => x.includes('Приходите на вечер!'))).toHaveLength(1);
    expect(texts(designer.id).some((x) => x.includes('Публикующий'))).toBe(true);
    const after = await apiJson<MeetingDetail>(`/api/meetings/${m.id}`, { user: publisher });
    expect(after.publishRequest).toBeNull();
    expect(after.announcedAt).not.toBeNull();

    // A declined one isn't sent, and the designer hears it.
    const again = await apiJson<{ id: number }>(`/api/meetings/${m.id}/announce/request`, {
      method: 'POST',
      user: designer,
      json: { notice: 'announce', text: 'Вторая версия' },
    });
    await apiJson(`/api/publish-requests/${again.id}/decline`, { method: 'POST', user: publisher });
    expect(
      (await api(`/api/publish-requests/${again.id}/send`, { method: 'POST', user: publisher }))
        .status,
    ).toBe(409);
    await drain();
    expect(texts(member.id).some((x) => x.includes('Вторая версия'))).toBe(false);

    // Publishers send announcements themselves.
    const direct = await apiJson<{ sent: number }>(`/api/meetings/${m.id}/announce`, {
      method: 'POST',
      user: publisher,
      json: { notice: 'announce', text: 'Сам отправил' },
    });
    expect(direct.sent).toBeGreaterThan(0);

    // Events work the same way: the designer prepares, the publisher sends.
    const ev = await apiJson<{ id: number }>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Лагерь', date: '2031-05-01', startTime: '10:00' },
    });
    const evSeen = await apiJson<EventDetail>(`/api/events/${ev.id}`, { user: designer });
    expect(evSeen).toMatchObject({ canPrepare: true, canPublish: false, canDesign: true });
    // The designer may change the event's speakers (they are on its poster), not its title.
    expect(
      (
        await api(`/api/events/${ev.id}`, {
          method: 'PATCH',
          user: designer,
          json: { speakers: [{ name: 'Гость' }] },
        })
      ).status,
    ).toBe(200);
    expect(
      (await api(`/api/events/${ev.id}`, { method: 'PATCH', user: designer, json: { title: 'X' } }))
        .status,
    ).toBe(403);
    const evReq = await apiJson<{ id: number }>(`/api/events/${ev.id}/remind/request`, {
      method: 'POST',
      user: designer,
      json: { text: 'Едем в лагерь' },
    });
    const sent = await apiJson<{ sent: number }>(`/api/publish-requests/${evReq.id}/send`, {
      method: 'POST',
      user: publisher,
    });
    expect(sent.sent).toBeGreaterThan(0);
    await drain();
    expect(texts(member.id).some((x) => x.includes('Едем в лагерь'))).toBe(true);
  });
  it('a part can be recorded as a looping video that plays from a public link', async () => {
    const g = await createEnv('Видео');
    const other = await createEnv('Чужое');
    const mp4 = Uint8Array.from([
      0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2,
    ]);
    const upload = (groupId: number, body: Uint8Array) =>
      api(`/api/groups/${groupId}/loops`, { method: 'POST', user: ADMIN, body });
    expect((await upload(g.id, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).status).toBe(415);
    const mine = (await (await upload(g.id, mp4)).json()) as { id: number; url: string };
    const theirs = (await (await upload(other.id, mp4)).json()) as { id: number };
    expect(mine.url).toBe(`/media/v/${mine.id}`);

    // iPhones play videos only with byte ranges.
    const whole = await api(mine.url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    const part = await api(mine.url, { headers: { Range: 'bytes=4-7' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-7/${mp4.length}`);
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([0x66, 0x74, 0x79, 0x70]);

    const baked = (mediaId: number) => ({ mediaId, key: 'abc', w: 370, h: 96 });
    const put = (json: unknown) =>
      api(`/api/groups/${g.id}/studio`, { method: 'PUT', user: ADMIN, json });
    // Another ministry's video is refused.
    expect(
      (await put({ screenLook: { header: { motion: 'snow', baked: baked(theirs.id) } } })).status,
    ).toBe(400);
    expect(
      (
        await put({
          screenLook: {
            header: { motion: 'snow', baked: baked(mine.id) },
            // A part with several blocks a screen keeps live animations.
            actions: { motion: 'snow', baked: baked(mine.id) },
          },
        })
      ).status,
    ).toBe(200);
    const saved = (await apiJson<GroupSummary[]>('/api/groups', { user: ADMIN })).find(
      (x) => x.id === g.id,
    )!;
    expect(saved.screenLook.header?.baked).toEqual(baked(mine.id));
    expect(saved.screenLook.actions?.baked ?? null).toBeNull();
  });
});
