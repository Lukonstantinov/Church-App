import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  DEFAULT_PATTERN,
  type GroupDetail,
  type GroupSummary,
  type MemberRow,
} from '@church/shared';
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
  sendBotPromoted,
  sendGroupCommand,
  sendJoinRequest,
  sendText,
  type FakeTgUser,
} from './helpers';

afterEach(() => vi.unstubAllGlobals());

let chatSeq = -1_000_000;
const newChat = (title: string) => ({ id: --chatSeq, title });

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
  return row;
}

async function linkCode(groupId: number) {
  const { url } = await apiJson<{ url: string }>(`/api/groups/${groupId}/chat/link`, {
    method: 'POST',
    user: ADMIN,
  });
  // Telegram's format: rights joined by a literal "+".
  expect(url).toContain('&admin=invite_users+restrict_members');
  return new URL(url).searchParams.get('startgroup')!;
}

describe('members-only ministry chat', () => {
  it('links a chat, approves members and declines everyone else', async () => {
    const calls = mockTelegram();
    const g = await createEnv('Чат служения');
    const member = fakeUser('Свой');
    const memberRow = await join(member, g);
    const stranger = fakeUser('Чужой');
    const chat = newChat('Молодёжь — чат');

    await sendGroupCommand(ADMIN, chat, `/start ${await linkCode(g.id)}`);
    expect(callsTo(calls, 'createChatInviteLink', chat.id)).toHaveLength(1);
    expect(String(callsTo(calls, 'sendMessage', chat.id).at(-1)!.body.text)).toContain(
      'Чат служения',
    );

    const d = await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: member });
    expect(d.chatUrl).toBe(`https://t.me/+inv${chat.id}`);
    expect(d.managedChat).toEqual({ title: 'Молодёжь — чат', pending: false });

    await sendJoinRequest(member, chat);
    expect(callsTo(calls, 'approveChatJoinRequest', chat.id)).toHaveLength(1);
    await sendJoinRequest(stranger, chat);
    expect(callsTo(calls, 'declineChatJoinRequest', chat.id)).toHaveLength(1);
    expect(String(callsTo(calls, 'sendMessage', stranger.id).at(-1)!.body.text)).toContain(
      'только для участников',
    );

    // Leaving the ministry removes the person from the chat (kick, not a lasting ban).
    await apiJson(`/api/memberships/${memberRow.membershipId}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { status: 'left' },
    });
    await drainOutbox(getDb(env.DB), botApi(env), { limit: 50 });
    expect(callsTo(calls, 'banChatMember', chat.id).map((c) => c.body.user_id)).toEqual([
      member.id,
    ]);
    expect(callsTo(calls, 'unbanChatMember', chat.id)).toHaveLength(1);
  });

  it('only people with the settings right can link, and the code is single-use', async () => {
    const calls = mockTelegram();
    const g = await createEnv('Права чата');
    const plain = fakeUser('Простой');
    await join(plain, g);
    const code = await linkCode(g.id);
    const chat = newChat('Левый чат');
    await sendGroupCommand(plain, chat, `/start ${code}`);
    expect(callsTo(calls, 'createChatInviteLink')).toHaveLength(0);
    await sendGroupCommand(ADMIN, chat, `/start ${code}`);
    await sendGroupCommand(ADMIN, newChat('Второй'), `/start ${code}`);
    expect(callsTo(calls, 'createChatInviteLink')).toHaveLength(1);
  });

  it('finishes linking once the bot is made an admin', async () => {
    const calls = mockTelegram({ failMethods: ['createChatInviteLink'] });
    const g = await createEnv('Позже админ');
    const chat = newChat('Без прав');
    await sendGroupCommand(ADMIN, chat, `/start ${await linkCode(g.id)}`);
    expect(String(callsTo(calls, 'sendMessage', chat.id).at(-1)!.body.text)).toContain(
      'администратором',
    );
    let d = await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: ADMIN });
    expect(d.managedChat).toEqual({ title: 'Без прав', pending: true });

    vi.unstubAllGlobals();
    mockTelegram();
    await sendBotPromoted(chat, ADMIN);
    d = await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: ADMIN });
    expect(d.managedChat).toEqual({ title: 'Без прав', pending: false });
    expect(d.chatUrl).toBe(`https://t.me/+inv${chat.id}`);
  });

  it('unlinking revokes the link and the bot leaves', async () => {
    const calls = mockTelegram();
    const g = await createEnv('Отключение');
    const chat = newChat('Старый чат');
    await sendGroupCommand(ADMIN, chat, `/start ${await linkCode(g.id)}`);
    await api(`/api/groups/${g.id}/chat`, { method: 'DELETE', user: ADMIN });
    expect(callsTo(calls, 'revokeChatInviteLink', chat.id)).toHaveLength(1);
    expect(callsTo(calls, 'leaveChat', chat.id)).toHaveLength(1);
    const d = await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: ADMIN });
    expect(d).toMatchObject({ managedChat: null, chatUrl: null });
  });
});

describe('ministry look and deletion', () => {
  it('stores a pattern and rejects unsafe icons', async () => {
    mockTelegram();
    const g = await createEnv('Узор');
    await apiJson(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { pattern: { ...DEFAULT_PATTERN, value: '🎸', angle: 30 } },
    });
    const s = (await apiJson<GroupSummary[]>('/api/groups', { user: ADMIN })).find(
      (x) => x.id === g.id,
    )!;
    expect(s.pattern).toEqual({ ...DEFAULT_PATTERN, value: '🎸', angle: 30 });
    expect(s).toMatchObject({ textColor: 'auto', animation: 'rise' });
    await apiJson(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { textColor: '#1a1a1a', animation: 'flip' },
    });
    const after = (await apiJson<GroupSummary[]>('/api/groups', { user: ADMIN })).find(
      (x) => x.id === g.id,
    )!;
    expect(after).toMatchObject({ textColor: '#1a1a1a', animation: 'flip' });
    const badText = await api(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { textColor: 'red; background:url(x)' },
    });
    expect(badText.status).toBe(400);
    for (const bad of [
      { ...DEFAULT_PATTERN, value: '<svg onload=x>' },
      { ...DEFAULT_PATTERN, angle: 120 },
      { ...DEFAULT_PATTERN, layout: 'spiral' },
      { ...DEFAULT_PATTERN, kind: 'preset', value: 'nope' },
    ]) {
      const res = await api(`/api/groups/${g.id}`, {
        method: 'PATCH',
        user: ADMIN,
        json: { pattern: bad },
      });
      expect(res.status).toBe(400);
    }
  });

  it('admins delete (archive) and restore a ministry; members stop seeing it', async () => {
    mockTelegram();
    const g = await createEnv('Удаляемое');
    const m = fakeUser('Участник удаляемого');
    await join(m, g);
    expect((await api(`/api/groups/${g.id}/archive`, { method: 'POST', user: m })).status).toBe(
      403,
    );
    await apiJson(`/api/groups/${g.id}/archive`, { method: 'POST', user: ADMIN });
    const mine = await apiJson<GroupSummary[]>('/api/groups', { user: m });
    expect(mine.map((x) => x.id)).not.toContain(g.id);
    const archived = await apiJson<GroupSummary[]>('/api/groups?archived=1', { user: ADMIN });
    expect(archived.find((x) => x.id === g.id)!.archived).toBe(true);
    await apiJson(`/api/groups/${g.id}/restore`, { method: 'POST', user: ADMIN });
    const back = await apiJson<GroupSummary[]>('/api/groups', { user: m });
    expect(back.map((x) => x.id)).toContain(g.id);
  });
});
