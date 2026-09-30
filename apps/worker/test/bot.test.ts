import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { api } from './helpers';

interface TgCall {
  method: string;
  body: Record<string, unknown>;
}

/** Stubs the Telegram Bot API and records every call the bot makes. */
function mockTelegram(): TgCall[] {
  const calls: TgCall[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = url.pathname.split('/').pop()!;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method, body });
    const result =
      method === 'getMe'
        ? {
            id: 999,
            is_bot: true,
            first_name: 'TestBot',
            username: 'test_bot',
            can_join_groups: true,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
          }
        : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const startUpdate = (fromId: number) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: fromId, type: 'private', first_name: 'Анна' },
    from: { id: fromId, is_bot: false, first_name: 'Анна', language_code: 'ru' },
    text: '/start',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  },
});

describe('bot webhook', () => {
  it('rejects updates without the secret token', async () => {
    const calls = mockTelegram();
    const res = await api('/bot/webhook', {
      method: 'POST',
      body: JSON.stringify(startUpdate(3001)),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('answers /start with a Mini App button and stores the user', async () => {
    const calls = mockTelegram();
    const res = await api('/bot/webhook', {
      method: 'POST',
      body: JSON.stringify(startUpdate(3002)),
      headers: {
        'content-type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': env.WEBHOOK_SECRET,
      },
    });
    expect(res.status).toBe(200);
    const send = calls.find((c) => c.method === 'sendMessage');
    expect(send?.body.text).toContain('Привет, Анна');
    expect(JSON.stringify(send?.body.reply_markup)).toContain('https://app.test');

    const row = await env.DB.prepare('SELECT first_name FROM users WHERE telegram_id = ?')
      .bind(3002)
      .first<{ first_name: string }>();
    expect(row?.first_name).toBe('Анна');
  });
});

describe('bot setup', () => {
  it('requires the setup secret', async () => {
    mockTelegram();
    const res = await api('/bot/setup', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('registers webhook, commands and menu button', async () => {
    const calls = mockTelegram();
    const res = await api('/bot/setup', {
      method: 'POST',
      headers: { 'X-Setup-Secret': env.WEBHOOK_SECRET },
    });
    expect(res.status).toBe(200);
    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(
      expect.arrayContaining(['setWebhook', 'setMyCommands', 'setChatMenuButton']),
    );
    const hook = calls.find((c) => c.method === 'setWebhook');
    expect(hook?.body).toMatchObject({
      url: 'https://app.test/bot/webhook',
      secret_token: env.WEBHOOK_SECRET,
    });
  });
});
