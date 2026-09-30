import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  PERMISSIONS,
  type GroupDetail,
  type GroupSummary,
  type MeResponse,
  type MemberDetail,
  type MemberRow,
  type PositionRow,
} from '@church/shared';
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

async function createGroup(name: string): Promise<{ id: number; inviteCode: string }> {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  const detail = await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
  const inviteCode = new URL(detail.inviteLink!).searchParams.get('start')!.slice(2);
  return { id, inviteCode };
}

/** Full join flow through the bot: /start g_<code> → accept privacy → pending. */
async function requestJoin(user: FakeTgUser, inviteCode: string) {
  await sendText(user, `/start g_${inviteCode}`);
  await pressButton(user, `pv:g_${inviteCode}`);
}

async function membersOf(groupId: number, as: FakeTgUser = ADMIN) {
  return apiJson<MemberRow[]>(`/api/groups/${groupId}/members`, { user: as });
}

/** Id of the environment's "Leader" position (all rights). */
async function leaderPositionId(groupId: number) {
  const list = await apiJson<PositionRow[]>(`/api/groups/${groupId}/positions`, { user: ADMIN });
  return list.find((p) => !p.isDefault && p.permissions.length === PERMISSIONS.length)!.id;
}

async function joinAndApprove(user: FakeTgUser, group: { id: number; inviteCode: string }) {
  await requestJoin(user, group.inviteCode);
  const row = (await membersOf(group.id)).find(
    (m) => m.username === user.username || m.firstName === user.first_name,
  )!;
  await apiJson(`/api/memberships/${row.membershipId}`, {
    method: 'PATCH',
    user: ADMIN,
    json: { status: 'active' },
  });
  return row;
}

describe('groups', () => {
  it('only admins can create groups', async () => {
    const res = await api('/api/groups', {
      method: 'POST',
      user: fakeUser('Не админ'),
      json: { name: 'X' },
    });
    expect(res.status).toBe(403);
  });

  it('validates input', async () => {
    const res = await api('/api/groups', { method: 'POST', user: ADMIN, json: { name: '   ' } });
    expect(res.status).toBe(400);
  });

  it('admin creates a group and gets an invite link', async () => {
    const { id } = await apiJson<{ id: number }>('/api/groups', {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Молодёжь 14–17', description: 'Пятница' },
    });
    const detail = await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
    expect(detail).toMatchObject({ name: 'Молодёжь 14–17', canManage: true, activeCount: 0 });
    expect(detail.inviteLink).toMatch(/^https:\/\/t\.me\/test_bot\?start=g_[a-z0-9]{10}$/);
    const list = await apiJson<GroupSummary[]>('/api/groups', { user: ADMIN });
    expect(list.some((g) => g.id === id)).toBe(true);
  });

  it('rotating the invite link invalidates the old one', async () => {
    const group = await createGroup('Ротация');
    await apiJson(`/api/groups/${group.id}/invite/rotate`, { method: 'POST', user: ADMIN });
    const user = fakeUser('Опоздавший');
    await requestJoin(user, group.inviteCode);
    const texts = callsTo(calls, 'sendMessage', user.id).map((c) => String(c.body.text));
    expect(texts.some((t) => t.includes('недействительна'))).toBe(true);
    expect(await membersOf(group.id)).toHaveLength(0);
  });

  it('outsiders cannot see a group', async () => {
    const group = await createGroup('Секретная');
    const res = await api(`/api/groups/${group.id}`, { user: fakeUser('Чужой') });
    expect(res.status).toBe(404);
  });
});

describe('join flow', () => {
  it('asks for privacy consent, creates a pending request and notifies admins when no leaders', async () => {
    await api('/api/me', { user: ADMIN }); // admin has a Telegram chat with the bot
    const group = await createGroup('Без лидеров');
    const anna = fakeUser('Анна', { username: 'anna_p' });

    await sendText(anna, `/start g_${group.inviteCode}`);
    const notice = callsTo(calls, 'sendMessage', anna.id).at(-1)!;
    expect(String(notice.body.text)).toContain('Прежде чем продолжить');
    expect(await membersOf(group.id)).toHaveLength(0);

    await pressButton(anna, `pv:g_${group.inviteCode}`);
    const members = await membersOf(group.id);
    expect(members).toMatchObject([{ firstName: 'Анна', status: 'pending', role: 'member' }]);

    const card = callsTo(calls, 'sendMessage', ADMIN.id).at(-1)!;
    expect(String(card.body.text)).toContain('Новая заявка');
    expect(String(card.body.text)).toContain('Анна');
    expect(JSON.stringify(card.body.reply_markup)).toContain(`jr:a:${members[0]!.membershipId}`);
  });

  it('approval via bot button activates the member, updates cards and notifies the member', async () => {
    const group = await createGroup('Одобрение');
    const boris = fakeUser('Борис');
    await requestJoin(boris, group.inviteCode);
    const [pending] = await membersOf(group.id);

    await pressButton(ADMIN, `jr:a:${pending!.membershipId}`);
    const [active] = await membersOf(group.id);
    expect(active).toMatchObject({ status: 'active' });
    expect(active!.joinedAt).not.toBeNull();

    expect(
      callsTo(calls, 'editMessageText').some((c) => String(c.body.text).includes('принят')),
    ).toBe(true);
    const toMember = callsTo(calls, 'sendMessage', boris.id).at(-1)!;
    expect(String(toMember.body.text)).toContain('Вас приняли');

    const me = await apiJson<MeResponse>('/api/me', { user: boris });
    expect(me.memberships).toMatchObject([{ groupId: group.id, status: 'active', role: 'member' }]);
  });

  it('second decision is reported as already handled', async () => {
    const group = await createGroup('Дважды');
    const u = fakeUser('Вера');
    await requestJoin(u, group.inviteCode);
    const [row] = await membersOf(group.id);
    await pressButton(ADMIN, `jr:r:${row!.membershipId}`);
    await pressButton(ADMIN, `jr:a:${row!.membershipId}`);
    expect((await membersOf(group.id)).length).toBe(0); // rejected is hidden from the default list
    const answers = callsTo(calls, 'answerCallbackQuery').map((c) => c.body.text);
    expect(answers).toContain('Заявка уже обработана.');
  });

  it('a regular member cannot approve requests', async () => {
    const group = await createGroup('Права');
    const member = fakeUser('Участник', { username: 'plain_member' });
    await joinAndApprove(member, group);
    const newcomer = fakeUser('Новичок');
    await requestJoin(newcomer, group.inviteCode);
    const pending = (await membersOf(group.id)).find((m) => m.status === 'pending')!;

    await pressButton(member, `jr:a:${pending.membershipId}`);
    expect(callsTo(calls, 'answerCallbackQuery').at(-1)!.body).toMatchObject({
      text: 'Недостаточно прав.',
    });
    const res = await api(`/api/memberships/${pending.membershipId}`, {
      method: 'PATCH',
      user: member,
      json: { status: 'active' },
    });
    expect(res.status).toBe(404);
    expect((await api(`/api/groups/${group.id}/members`, { user: member })).status).toBe(403);
  });

  it('marks leaders who blocked the bot as unreachable', async () => {
    const group = await createGroup('Блок');
    const leader = fakeUser('Лидер', { username: 'blocked_leader' });
    const row = await joinAndApprove(leader, group);
    await apiJson(`/api/memberships/${row.membershipId}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { positionId: await leaderPositionId(group.id) },
    });

    vi.unstubAllGlobals();
    calls = mockTelegram({ failFor: [leader.id] });
    await requestJoin(fakeUser('Гость'), group.inviteCode);
    const leaderRow = (await membersOf(group.id)).find((m) => m.userId === row.userId)!;
    expect(leaderRow.isReachable).toBe(false);
  });
});

describe('roles and removal', () => {
  it('leaders promote within their rights but cannot touch equal leaders or themselves', async () => {
    const group = await createGroup('Роли');
    const l1 = fakeUser('Лидер1', { username: 'l1' });
    const l2 = fakeUser('Лидер2', { username: 'l2' });
    const m = fakeUser('Участник3', { username: 'm3' });
    const m4 = fakeUser('Участник4', { username: 'm4' });
    const r1 = await joinAndApprove(l1, group);
    const r2 = await joinAndApprove(l2, group);
    const r3 = await joinAndApprove(m, group);
    const r4 = await joinAndApprove(m4, group);
    const leader = await leaderPositionId(group.id);

    for (const r of [r1, r2]) {
      await apiJson(`/api/memberships/${r.membershipId}`, {
        method: 'PATCH',
        user: ADMIN,
        json: { positionId: leader },
      });
    }
    const patch = (who: FakeTgUser, membershipId: number, json: unknown) =>
      api(`/api/memberships/${membershipId}`, { method: 'PATCH', user: who, json });

    expect((await patch(l1, r2.membershipId, { status: 'left' })).status).toBe(403);
    expect((await patch(l1, r1.membershipId, { positionId: leader })).status).toBe(200); // no-op
    const defaultId = (
      await apiJson<PositionRow[]>(`/api/groups/${group.id}/positions`, { user: ADMIN })
    ).find((p) => p.isDefault)!.id;
    expect((await patch(l1, r1.membershipId, { positionId: defaultId })).status).toBe(403);
    expect((await patch(l1, r2.membershipId, { positionId: defaultId })).status).toBe(403);

    expect((await patch(l1, r4.membershipId, { positionId: leader })).status).toBe(200);
    const list = await membersOf(group.id, l1);
    expect(list.find((x) => x.userId === r4.userId)!.positionName).toBe('Лидер');

    expect((await patch(l1, r3.membershipId, { status: 'left' })).status).toBe(200);
    expect((await membersOf(group.id, l1)).map((x) => x.userId)).not.toContain(r3.userId);
    const me = await apiJson<MeResponse>('/api/me', { user: m });
    expect(me.memberships).toEqual([]);
  });

  it('archived groups disappear for members', async () => {
    const group = await createGroup('Архив');
    const u = fakeUser('Архивный');
    await joinAndApprove(u, group);
    await apiJson(`/api/groups/${group.id}/archive`, { method: 'POST', user: ADMIN });
    expect((await apiJson<MeResponse>('/api/me', { user: u })).memberships).toEqual([]);
    expect((await apiJson<GroupSummary[]>('/api/groups', { user: u })).length).toBe(0);
  });
});

describe('offline members and claim codes', () => {
  it('leader adds an offline member, issues a claim code, and the member links Telegram', async () => {
    const group = await createGroup('Офлайн');
    const created = await apiJson<{ userId: number }>(`/api/groups/${group.id}/members`, {
      method: 'POST',
      user: ADMIN,
      json: { firstName: 'Даша', lastName: 'Смирнова', guardianConsent: true },
    });
    const row = (await membersOf(group.id)).find((m) => m.userId === created.userId)!;
    expect(row).toMatchObject({ offline: true, status: 'active', guardianConsent: true });

    const claim = await apiJson<{ link: string; code: string }>(
      `/api/users/${created.userId}/claim-code`,
      {
        method: 'POST',
        user: ADMIN,
      },
    );
    expect(claim.link).toBe(`https://t.me/test_bot?start=c_${claim.code}`);

    const dasha = fakeUser('dasha_nick', { username: 'dasha' });
    await sendText(dasha, `/start c_${claim.code}`);
    await pressButton(dasha, `pv:c_${claim.code}`);
    expect(String(callsTo(calls, 'sendMessage', dasha.id).at(-1)!.body.text)).toContain(
      'Даша Смирнова',
    );

    const me = await apiJson<MeResponse>('/api/me', { user: dasha });
    expect(me.user).toMatchObject({
      id: created.userId,
      firstName: 'Даша',
      telegramId: dasha.id,
      privacyAccepted: true,
    });
    expect(me.memberships).toMatchObject([{ groupId: group.id, status: 'active' }]);

    // Code is single-use.
    const other = fakeUser('Другой');
    await sendText(other, `/start c_${claim.code}`);
    await pressButton(other, `pv:c_${claim.code}`);
    expect(String(callsTo(calls, 'sendMessage', other.id).at(-1)!.body.text)).toContain(
      'недействителен',
    );
  });

  it('refuses to claim into an account that already has memberships', async () => {
    const group = await createGroup('Конфликт');
    const { userId } = await apiJson<{ userId: number }>(`/api/groups/${group.id}/members`, {
      method: 'POST',
      user: ADMIN,
      json: { firstName: 'Офлайн' },
    });
    const { code } = await apiJson<{ code: string }>(`/api/users/${userId}/claim-code`, {
      method: 'POST',
      user: ADMIN,
    });
    const existing = fakeUser('Уже участник', { username: 'already' });
    await joinAndApprove(existing, group);
    await sendText(existing, `/start c_${code}`);
    expect(String(callsTo(calls, 'sendMessage', existing.id).at(-1)!.body.text)).toContain(
      'уже зарегистрирован',
    );
  });

  it('leaders edit names and consent; users see their own detail; outsiders get 404', async () => {
    const group = await createGroup('Профили');
    const u = fakeUser('Ник', { username: 'nick_profile' });
    const row = await joinAndApprove(u, group);
    await apiJson(`/api/users/${row.userId}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { firstName: 'Николай', lastName: 'Иванов', guardianConsent: true },
    });
    const detail = await apiJson<MemberDetail>(`/api/users/${row.userId}`, { user: u });
    expect(detail.user).toMatchObject({ firstName: 'Николай', lastName: 'Иванов' });
    expect(detail.user.guardianConsentAt).not.toBeNull();
    expect(detail.permissions.canEditProfile).toBe(false);

    expect((await api(`/api/users/${row.userId}`, { user: fakeUser('Посторонний') })).status).toBe(
      404,
    );
  });

  it('admin grants admin to others but not to self', async () => {
    const u = fakeUser('Будущий админ');
    const me = await apiJson<MeResponse>('/api/me', { user: u });
    const adminMe = await apiJson<MeResponse>('/api/me', { user: ADMIN });
    await apiJson(`/api/users/${me.user.id}/admin`, {
      method: 'POST',
      user: ADMIN,
      json: { isAdmin: true },
    });
    expect((await apiJson<MeResponse>('/api/me', { user: u })).user.isAdmin).toBe(true);
    const self = await api(`/api/users/${adminMe.user.id}/admin`, {
      method: 'POST',
      user: ADMIN,
      json: { isAdmin: false },
    });
    expect(self.status).toBe(409);
  });
});

it('env binding sanity', () => {
  expect(env.ADMIN_TELEGRAM_IDS).toBe('1001');
});
