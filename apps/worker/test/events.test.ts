import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EventDetail,
  type EventSummary,
  type GroupDetail,
  type MeResponse,
  type MemberRow,
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

/** Local date `n` days from now ("YYYY-MM-DD"). */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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

async function createEvent(groupId: number, json: Record<string, unknown>) {
  return post<EventDetail>(`/api/groups/${groupId}/events`, {
    title: 'Лагерь',
    date: inDays(10),
    startTime: '10:00',
    ...json,
  });
}

describe('events', () => {
  it('creates a minimal event and lists it as upcoming for members', async () => {
    const g = await createGroup('События');
    const member = fakeUser('Юля');
    await joinAndApprove(member, g);
    const e = await createEvent(g.id, { description: 'Три дня у озера', location: 'Тракай' });
    expect(e).toMatchObject({
      title: 'Лагерь',
      description: 'Три дня у озера',
      features: { gallery: false, rsvp: false, duties: false, cost: false },
      canManage: true,
      finance: null,
    });
    const list = await apiJson<EventSummary[]>(`/api/groups/${g.id}/events`, { user: member });
    expect(list.map((x) => x.id)).toEqual([e.id]);
    const mine = await apiJson<EventSummary[]>('/api/me/events', { user: member });
    expect(mine.some((x) => x.id === e.id)).toBe(true);
    const past = await apiJson<EventSummary[]>(`/api/groups/${g.id}/events?scope=past`, {
      user: member,
    });
    expect(past).toEqual([]);
    const asMember = await apiJson<EventDetail>(`/api/events/${e.id}`, { user: member });
    expect(asMember.canManage).toBe(false);
  });

  it('rejects an end before the start and hides events from outsiders', async () => {
    const g = await createGroup('Время');
    const bad = await api(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'X', date: inDays(3), startTime: '18:00', endTime: '17:00' },
    });
    expect(bad.status).toBe(400);
    const e = await createEvent(g.id, { endDate: inDays(12), endTime: '16:00' });
    expect(Date.parse(e.endsAt!) - Date.parse(e.startsAt)).toBeGreaterThan(2 * 86_400_000);
    expect((await api(`/api/events/${e.id}`, { user: fakeUser('Чужой') })).status).toBe(404);
  });

  it('RSVP: members answer for themselves, leaders for anyone; counts update', async () => {
    const g = await createGroup('Ответы');
    const a = fakeUser('Аня');
    const b = fakeUser('Боря');
    await joinAndApprove(a, g);
    await joinAndApprove(b, g);
    const offline = await addOffline(g.id, 'Вова');
    const e = await createEvent(g.id, { features: { rsvp: true } });
    const put = (user: FakeTgUser, json: unknown) =>
      api(`/api/events/${e.id}/rsvp`, { method: 'PUT', user, json });

    expect((await put(a, { status: 'going' })).status).toBe(200);
    expect((await put(b, { status: 'not_going' })).status).toBe(200);
    expect((await put(a, { status: 'going', userId: offline })).status).toBe(403);
    expect((await put(ADMIN, { status: 'going', userId: offline })).status).toBe(200);

    const d = await apiJson<EventDetail>(`/api/events/${e.id}`, { user: ADMIN });
    expect(d.goingCount).toBe(2);
    expect(d.rsvps.going.map((p) => p.firstName).sort()).toEqual(['Аня', 'Вова']);
    expect(d.rsvps.notGoing.map((p) => p.firstName)).toEqual(['Боря']);
    const asA = await apiJson<EventDetail>(`/api/events/${e.id}`, { user: a });
    expect(asA.myRsvp).toBe('going');
    expect(asA.rsvps.noAnswer).toEqual([]);

    await put(a, { status: null });
    const after = await apiJson<EventDetail>(`/api/events/${e.id}`, { user: a });
    expect(after.myRsvp).toBeNull();

    const noRsvp = await createEvent(g.id, {});
    const off = await api(`/api/events/${noRsvp.id}/rsvp`, {
      method: 'PUT',
      user: a,
      json: { status: 'going' },
    });
    expect(off.status).toBe(409);
  });

  it('duty roles: create with people, edit later, members see their duties', async () => {
    const g = await createGroup('Служения');
    const c1 = fakeUser('Света');
    const u1 = await joinAndApprove(c1, g);
    const u2 = await addOffline(g.id, 'Тимур');
    const e = await createEvent(g.id, {
      roles: [
        { name: 'Прославление', slots: 2, userIds: [u1] },
        { name: 'Еда', userIds: [u2] },
      ],
    });
    expect(e.features.duties).toBe(true);
    expect(e.roles.map((r) => [r.name, r.slots, r.assignees.map((p) => p.id)])).toEqual([
      ['Прославление', 2, [u1]],
      ['Еда', 1, [u2]],
    ]);
    const mine = await apiJson<EventSummary[]>('/api/me/events', { user: c1 });
    expect(mine.find((x) => x.id === e.id)!.myRoles).toEqual(['Прославление']);

    const worship = e.roles[0]!;
    const edited = await apiJson<EventDetail>(`/api/events/${e.id}/roles`, {
      method: 'PUT',
      user: ADMIN,
      json: {
        roles: [
          { id: worship.id, name: 'Музыка', slots: 3, userIds: [u1, u2] },
          { name: 'Фото', userIds: [] },
        ],
      },
    });
    expect(edited.roles.map((r) => r.name)).toEqual(['Музыка', 'Фото']);
    expect(edited.roles[0]!.id).toBe(worship.id);
    expect(edited.roles[0]!.assignees).toHaveLength(2);

    const stranger = await addOffline((await createGroup('Другая группа')).id, 'Икс');
    const bad = await api(`/api/events/${e.id}/roles`, {
      method: 'PUT',
      user: ADMIN,
      json: { roles: [{ name: 'X', userIds: [stranger] }] },
    });
    expect(bad.status).toBe(400);
    const byMember = await api(`/api/events/${e.id}/roles`, {
      method: 'PUT',
      user: c1,
      json: { roles: [] },
    });
    expect(byMember.status).toBe(403);
  });

  it('sections can be switched on after creating, and the event edited', async () => {
    const g = await createGroup('Правки');
    const e = await createEvent(g.id, {});
    const edited = await apiJson<EventDetail>(`/api/events/${e.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: {
        title: 'Поездка',
        date: inDays(20),
        startTime: '09:00',
        features: { rsvp: true, cost: true },
        priceCents: 2500,
        chatUrl: 'https://t.me/+AbCdEf123',
      },
    });
    expect(edited).toMatchObject({
      title: 'Поездка',
      priceCents: 2500,
      chatUrl: 'https://t.me/+AbCdEf123',
      features: { gallery: false, rsvp: true, duties: false, cost: true },
    });
    const badLink = await api(`/api/events/${e.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { chatUrl: 'https://evil.example/t.me' },
    });
    expect(badLink.status).toBe(400);
    const cancelled = await apiJson<EventDetail>(`/api/events/${e.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { status: 'cancelled' },
    });
    expect(cancelled.status).toBe('cancelled');
  });

  it('cover and gallery photos come back as signed URLs', async () => {
    const g = await createGroup('Фото');
    const upload = async () => {
      const res = await api(`/api/groups/${g.id}/media?kind=event`, {
        method: 'POST',
        user: ADMIN,
        body: PNG,
      });
      return ((await res.json()) as { id: number }).id;
    };
    const cover = await upload();
    const e = await createEvent(g.id, { coverMediaId: cover, features: { gallery: true } });
    expect(e.coverUrl).toMatch(/^\/media\/m\/\d+\?e=/);
    const withPhotos = await post<EventDetail>(`/api/events/${e.id}/photos`, {
      mediaIds: [await upload(), await upload()],
    });
    expect(withPhotos.photos).toHaveLength(2);
    expect((await api(withPhotos.photos[0]!.url)).status).toBe(200);
    const removed = await apiJson<EventDetail>(
      `/api/events/${e.id}/photos/${withPhotos.photos[0]!.id}`,
      { method: 'DELETE', user: ADMIN },
    );
    expect(removed.photos).toHaveLength(1);
  });

  it('event money: payments and expenses are tracked per event and in the group balance', async () => {
    const g = await createGroup('Деньги события');
    const a = fakeUser('Гоша');
    const ua = await joinAndApprove(a, g);
    const ub = await addOffline(g.id, 'Дима');
    const e = await createEvent(g.id, { features: { rsvp: true, cost: true }, priceCents: 3000 });
    await apiJson(`/api/events/${e.id}/rsvp`, {
      method: 'PUT',
      user: a,
      json: { status: 'going' },
    });
    await post(`/api/events/${e.id}/payments`, { userId: ua });
    await post(`/api/events/${e.id}/payments`, { userId: ub, amountCents: 1000 });
    const d = await post<EventDetail>(`/api/events/${e.id}/expenses`, {
      amountCents: 4500,
      note: 'Автобус',
    });
    expect(d.finance).toMatchObject({ priceCents: 3000, collectedCents: 4000, expenseCents: 4500 });
    expect(d.finance!.people).toEqual([
      { member: { id: ua, firstName: 'Гоша', lastName: null }, paidCents: 3000, going: true },
      { member: { id: ub, firstName: 'Дима', lastName: null }, paidCents: 1000, going: false },
    ]);
    const asA = await apiJson<EventDetail>(`/api/events/${e.id}`, { user: a });
    expect(asA).toMatchObject({ myPaidCents: 3000, finance: null });

    const s = await apiJson<TreasurySummary>(`/api/groups/${g.id}/treasury`, { user: ADMIN });
    expect(s.balanceCents).toBe(4000 - 4500);
    expect(s.expenseByCategory).toEqual([{ category: 'events', cents: 4500 }]);

    const noCost = await createEvent(g.id, {});
    const off = await api(`/api/events/${noCost.id}/payments`, {
      method: 'POST',
      user: ADMIN,
      json: { userId: ua },
    });
    expect(off.status).toBe(409);
  });
});

describe('group chat link', () => {
  it('leaders link a Telegram chat; active members get it in /me', async () => {
    const g = await createGroup('Чат');
    const m = fakeUser('Лиза');
    await joinAndApprove(m, g);
    await apiJson(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { chatUrl: 'https://t.me/youth_chat' },
    });
    const detail = await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: m });
    expect(detail.chatUrl).toBe('https://t.me/youth_chat');
    const me = await apiJson<MeResponse>('/api/me', { user: m });
    expect(me.memberships.find((x) => x.groupId === g.id)!.chatUrl).toBe('https://t.me/youth_chat');
    const bad = await api(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { chatUrl: 'javascript:alert(1)' },
    });
    expect(bad.status).toBe(400);
  });
});
