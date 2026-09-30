import { describe, expect, it } from 'vitest';
import type { MeResponse, Telemetry } from '@church/shared';
import { api, makeInitData } from './helpers';

describe('/health', () => {
  it('reports ok with database check', async () => {
    const res = await api('/health?deep=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: 'ok' });
  });
});

describe('/api/me', () => {
  it('rejects requests without initData', async () => {
    const res = await api('/api/me');
    expect(res.status).toBe(401);
  });

  it('rejects forged initData', async () => {
    const forged = await makeInitData({ id: 7, first_name: 'X' }, { botToken: '1:WRONG' });
    const res = await api('/api/me', { headers: { Authorization: `tma ${forged}` } });
    expect(res.status).toBe(401);
  });

  it('creates the user on first call and returns the profile', async () => {
    const res = await api('/api/me', {
      user: { id: 2002, first_name: 'Мария', username: 'maria' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.user).toMatchObject({ telegramId: 2002, firstName: 'Мария', isAdmin: false });
    expect(body.memberships).toEqual([]);
  });

  it('refreshes username but keeps the stored (leader-editable) name, without duplicating', async () => {
    const first = (await (
      await api('/api/me', { user: { id: 2003, first_name: 'Original', username: 'old' } })
    ).json()) as MeResponse;
    const second = (await (
      await api('/api/me', { user: { id: 2003, first_name: 'Nickname', username: 'new' } })
    ).json()) as MeResponse;
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.firstName).toBe('Original');
    expect(second.user.username).toBe('new');
  });

  it('grants admin to ADMIN_TELEGRAM_IDS', async () => {
    const res = await api('/api/me', { user: { id: 1001, first_name: 'Админ' } });
    const body = (await res.json()) as MeResponse;
    expect(body.user.isAdmin).toBe(true);
  });
});

describe('unknown api route', () => {
  it('returns JSON 404', async () => {
    const res = await api('/api/nope', { user: { id: 2004, first_name: 'A' } });
    expect(res.status).toBe(404);
  });
});

describe('/api/dev/telemetry', () => {
  it('is only for the developers from ADMIN_TELEGRAM_IDS', async () => {
    const me = await (await api('/api/me', { user: { id: 1001, first_name: 'Админ' } })).json();
    expect((me as MeResponse).user.isDeveloper).toBe(true);
    const res = await api('/api/dev/telemetry', { user: { id: 1001, first_name: 'Админ' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Telemetry;
    expect(body.environment).toBeTruthy();
    expect(body.users.total).toBeGreaterThan(0);
    expect(body.users.active1d).toBeGreaterThan(0);
    expect(body.tables.find((t) => t.name === 'users')!.rows).toBeGreaterThan(0);
    expect(body.limits.length).toBeGreaterThan(3);
    expect((await api('/api/dev/telemetry', { user: { id: 7777, first_name: 'X' } })).status).toBe(
      403,
    );
  });
});
