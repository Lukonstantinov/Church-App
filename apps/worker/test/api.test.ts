import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@church/shared';
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

  it('keeps name fresh and does not duplicate the user', async () => {
    await api('/api/me', { user: { id: 2003, first_name: 'Old' } });
    const res = await api('/api/me', { user: { id: 2003, first_name: 'New' } });
    const body = (await res.json()) as MeResponse;
    expect(body.user.firstName).toBe('New');
    const first = (await (
      await api('/api/me', { user: { id: 2003, first_name: 'New' } })
    ).json()) as MeResponse;
    expect(first.user.id).toBe(body.user.id);
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
