import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupDetail, MeResponse, PositionRow, TestAsOptions } from '@church/shared';
import {
  ADMIN,
  api,
  apiJson,
  callsTo,
  fakeUser,
  mockTelegram,
  pressButton,
  sendText,
  type TgCall,
} from './helpers';

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
  return apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
}

describe('open the app as another role', () => {
  it('lets the developer work as a test person with the chosen position, then return', async () => {
    const g = await createEnv('Тест-роли');
    const created = await apiJson<PositionRow[]>(`/api/groups/${g.id}/positions`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Дизайнер', permissions: ['design'] },
    });
    const designer = created.find((p) => p.name === 'Дизайнер');

    const opts = await apiJson<TestAsOptions>('/api/dev/test-as', { user: ADMIN });
    expect(opts.current).toBeNull();
    expect(opts.groups.find((x) => x.id === g.id)?.positions.map((p) => p.name)).toContain(
      'Дизайнер',
    );

    const { label } = await apiJson<{ label: string }>('/api/dev/test-as', {
      method: 'POST',
      user: ADMIN,
      json: { kind: 'position', positionId: designer!.id },
    });
    expect(label).toBe('Дизайнер · Тест-роли');

    // The app now works as the test person: no developer or admin screens, only design here.
    const me = await apiJson<MeResponse>('/api/me', { user: ADMIN });
    expect(me.user.testing).toBe('Дизайнер · Тест-роли');
    expect(me.user.isAdmin).toBe(false);
    expect(me.user.isDeveloper).toBe(false);
    expect(me.memberships).toHaveLength(1);
    expect(me.memberships[0]!.permissions).toEqual(['design']);
    expect((await api('/api/dev/telemetry', { user: ADMIN })).status).toBe(403);
    // Managing people is not a designer's right.
    expect((await api(`/api/groups/${g.id}/members`, { user: ADMIN })).status).toBe(403);
    // Still allowed to switch (it is the developer who signed in).
    expect((await apiJson<TestAsOptions>('/api/dev/test-as', { user: ADMIN })).current).toBe(
      'Дизайнер · Тест-роли',
    );

    // A newcomer has no ministry at all.
    await apiJson('/api/dev/test-as', { method: 'POST', user: ADMIN, json: { kind: 'newcomer' } });
    const newcomer = await apiJson<MeResponse>('/api/me', { user: ADMIN });
    expect(newcomer.memberships).toHaveLength(0);

    await apiJson('/api/dev/test-as', { method: 'DELETE', user: ADMIN });
    const back = await apiJson<MeResponse>('/api/me', { user: ADMIN });
    expect(back.user.testing).toBeNull();
    expect(back.user.isDeveloper).toBe(true);
  });

  it('is only for developers', async () => {
    const someone = fakeUser('Посторонний');
    expect((await api('/api/dev/test-as', { user: someone })).status).toBe(403);
    await sendText(someone, '/testas');
    expect(JSON.stringify(callsTo(calls, 'sendMessage', someone.id))).toContain(
      'только для разработчика',
    );
  });

  it('works from the bot', async () => {
    await sendText(ADMIN, '/testas');
    expect(JSON.stringify(callsTo(calls, 'sendMessage', ADMIN.id))).toContain('ta:a');
    await pressButton(ADMIN, 'ta:a');
    const me = await apiJson<MeResponse>('/api/me', { user: ADMIN });
    expect(me.user.testing).toBe('Администратор церкви');
    expect(me.user.isAdmin).toBe(true);
    expect(me.user.isDeveloper).toBe(false);
    await pressButton(ADMIN, 'ta:x');
    expect((await apiJson<MeResponse>('/api/me', { user: ADMIN })).user.testing).toBeNull();
  });
});
