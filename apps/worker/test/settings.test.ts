import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import type { AnnouncementResult, AnnouncementRow, ChurchInfo, MeResponse } from '@church/shared';
import {
  ADMIN,
  api,
  apiJson,
  callsTo,
  fakeUser,
  mockTelegram,
  sendText,
  type TgCall,
} from './helpers';

let calls: TgCall[];
beforeEach(() => {
  calls = mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

// 1×1 transparent PNG
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (ch) => ch.charCodeAt(0),
);

describe('language preference', () => {
  it('defaults to the church language and can be changed per user', async () => {
    const u = fakeUser('Язык');
    expect((await apiJson<MeResponse>('/api/me', { user: u })).user.locale).toBe('ru');
    const updated = await apiJson<MeResponse>('/api/me', {
      method: 'PATCH',
      user: u,
      json: { locale: 'lt' },
    });
    expect(updated.user.locale).toBe('lt');
    expect((await apiJson<MeResponse>('/api/me', { user: u })).user.locale).toBe('lt');
    expect(
      (await api('/api/me', { method: 'PATCH', user: u, json: { locale: 'de' } })).status,
    ).toBe(400);
  });

  it('the bot answers in the chosen language', async () => {
    const u = fakeUser('Jonas');
    await apiJson('/api/me', { method: 'PATCH', user: u, json: { locale: 'en' } });
    await sendText(u, '/start');
    expect(String(callsTo(calls, 'sendMessage', u.id).at(-1)!.body.text)).toContain('Hi, Jonas!');
    await apiJson('/api/me', { method: 'PATCH', user: u, json: { locale: 'lt' } });
    await sendText(u, '/start');
    expect(String(callsTo(calls, 'sendMessage', u.id).at(-1)!.body.text)).toContain(
      'Sveiki, Jonas!',
    );
  });
});

describe('church settings', () => {
  it('everyone can read; only admins can change', async () => {
    const u = fakeUser('Обычный');
    const church = await apiJson<ChurchInfo>('/api/church', { user: u });
    expect(church).toMatchObject({ brandColor: 'blue', defaultLocale: 'ru', logoUrl: null });
    expect(
      (await api('/api/church', { method: 'PATCH', user: u, json: { name: 'X' } })).status,
    ).toBe(403);
  });

  it('admin updates name, color, time zone and default language, with validation', async () => {
    const updated = await apiJson<ChurchInfo>('/api/church', {
      method: 'PATCH',
      user: ADMIN,
      json: {
        name: 'Церковь «Благодать»',
        brandColor: 'violet',
        timezone: 'Europe/Vilnius',
        defaultLocale: 'lt',
      },
    });
    expect(updated).toMatchObject({
      name: 'Церковь «Благодать»',
      brandColor: 'violet',
      timezone: 'Europe/Vilnius',
      defaultLocale: 'lt',
    });
    // New users now start in Lithuanian.
    expect((await apiJson<MeResponse>('/api/me', { user: fakeUser('Naujas') })).user.locale).toBe(
      'lt',
    );

    expect(
      (await api('/api/church', { method: 'PATCH', user: ADMIN, json: { timezone: 'Mars/Base' } }))
        .status,
    ).toBe(400);
    expect(
      (await api('/api/church', { method: 'PATCH', user: ADMIN, json: { brandColor: 'neon' } }))
        .status,
    ).toBe(400);

    await apiJson('/api/church', {
      method: 'PATCH',
      user: ADMIN,
      json: { brandColor: 'blue', timezone: 'Europe/Riga', defaultLocale: 'ru', name: 'Церковь' },
    });
  });
});

describe('logo', () => {
  const put = (body: BodyInit, user = ADMIN) =>
    api('/api/church/logo', {
      method: 'PUT',
      user,
      body,
      headers: { 'content-type': 'image/png' },
    });

  it('admin uploads a logo which is served publicly with caching, then removes it', async () => {
    expect((await put(PNG, fakeUser('Не админ'))).status).toBe(403);

    const res = await put(PNG);
    expect(res.status).toBe(200);
    const church = (await res.json()) as ChurchInfo;
    expect(church.logoUrl).toMatch(/^\/media\/logo\?v=/);

    const img = await api(church.logoUrl!);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);

    const removed = await apiJson<ChurchInfo>('/api/church/logo', {
      method: 'DELETE',
      user: ADMIN,
    });
    expect(removed.logoUrl).toBeNull();
    expect((await api('/media/logo')).status).toBe(404);
  });

  it('rejects files that are not images or too large', async () => {
    expect((await put(new TextEncoder().encode('<svg onload=alert(1)>'))).status).toBe(415);
    expect((await put(new Uint8Array(400_000))).status).toBe(413);
    expect((await put(new Uint8Array(0))).status).toBe(400);
  });
});

describe('announcements', () => {
  async function setup() {
    await apiJson('/api/me', { user: ADMIN });
    const { id: groupId } = await apiJson<{ id: number }>('/api/groups', {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Объявления' },
    });
    const reader = fakeUser('Читатель');
    const english = fakeUser('Reader');
    const blocked = fakeUser('Заблокировал');
    const pending = fakeUser('Ждёт');
    const ids: Record<string, number> = {};
    for (const [key, u] of Object.entries({ reader, english, blocked, pending })) {
      ids[key] = (await apiJson<MeResponse>('/api/me', { user: u })).user.id;
    }
    await apiJson('/api/me', { method: 'PATCH', user: english, json: { locale: 'en' } });
    for (const key of ['reader', 'english', 'blocked']) {
      await env.DB.prepare(
        "INSERT INTO memberships (user_id, group_id, status, role, joined_at) VALUES (?, ?, 'active', 'member', ?)",
      )
        .bind(ids[key], groupId, new Date().toISOString())
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO memberships (user_id, group_id, status, role) VALUES (?, ?, 'pending', 'member')",
    )
      .bind(ids.pending, groupId)
      .run();
    await env.DB.prepare('UPDATE users SET is_reachable = 0 WHERE id = ?').bind(ids.blocked).run();
    await apiJson(`/api/groups/${groupId}/members`, {
      method: 'POST',
      user: ADMIN,
      json: { firstName: 'Офлайн' },
    });
    return { groupId, reader, english, blocked, pending };
  }

  it('sends to active reachable members only, in their language, and lists history', async () => {
    const { groupId, reader, english, blocked, pending } = await setup();
    const result = await apiJson<AnnouncementResult>(`/api/groups/${groupId}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'Встреча в пятницу <b>в 19:00</b>' },
    });
    expect(result.announcement.recipients).toBe(2);
    expect(result.noTelegram).toBe(1);
    expect(result.unreachable).toBe(1);

    const toReader = callsTo(calls, 'sendMessage', reader.id).at(-1)!;
    expect(String(toReader.body.text)).toContain('📢 <b>Объявления</b>');
    expect(String(toReader.body.text)).toContain('&lt;b&gt;в 19:00&lt;/b&gt;'); // escaped
    expect(JSON.stringify(toReader.body.reply_markup)).toContain('Открыть приложение');
    const toEnglish = callsTo(calls, 'sendMessage', english.id).at(-1)!;
    expect(JSON.stringify(toEnglish.body.reply_markup)).toContain('Open app');
    expect(callsTo(calls, 'sendMessage', blocked.id)).toHaveLength(0);
    expect(callsTo(calls, 'sendMessage', pending.id)).toHaveLength(0);

    const list = await apiJson<AnnouncementRow[]>(`/api/groups/${groupId}/announcements`, {
      user: reader,
    });
    expect(list[0]).toMatchObject({ text: 'Встреча в пятницу <b>в 19:00</b>', recipients: 2 });
    const mine = await apiJson<AnnouncementRow[]>('/api/me/announcements', { user: reader });
    expect(mine[0]?.groupName).toBe('Объявления');
  });

  it('members cannot post; outsiders cannot read; empty text is rejected', async () => {
    const { groupId, reader } = await setup();
    expect(
      (
        await api(`/api/groups/${groupId}/announcements`, {
          method: 'POST',
          user: reader,
          json: { text: 'hi' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await api(`/api/groups/${groupId}/announcements`, { user: fakeUser('Чужой') })).status,
    ).toBe(404);
    expect(
      (
        await api(`/api/groups/${groupId}/announcements`, {
          method: 'POST',
          user: ADMIN,
          json: { text: '   ' },
        })
      ).status,
    ).toBe(400);
  });
});
