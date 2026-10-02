import { vi } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { signInitData } from '../src/auth/initData';
import { deriveToken } from '../src/lib/crypto';
import { app } from '../src/app';

export interface FakeTgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** Builds a correctly signed initData string, as Telegram would. */
export async function makeInitData(
  user: FakeTgUser,
  { authDate = Math.floor(Date.now() / 1000), botToken = env.BOT_TOKEN } = {},
): Promise<string> {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(user),
  };
  const hash = await signInitData(fields, botToken);
  return new URLSearchParams({ ...fields, hash }).toString();
}

/** Calls the Worker app; waits for waitUntil() work so assertions see its effects. */
export async function api(
  path: string,
  init: RequestInit & { user?: FakeTgUser; json?: unknown } = {},
) {
  const headers = new Headers(init.headers);
  if (init.user) headers.set('Authorization', `tma ${await makeInitData(init.user)}`);
  let body = init.body;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set('content-type', 'application/json');
  }
  const ctx = createExecutionContext();
  const res = await app.request(`https://app.test${path}`, { ...init, body, headers }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function apiJson<T>(path: string, init: Parameters<typeof api>[1] = {}): Promise<T> {
  const res = await api(path, init);
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// ---------- Telegram Bot API mock ----------

export interface TgCall {
  method: string;
  body: Record<string, unknown>;
}

let messageSeq = 100;

/** Stubs fetch to the Telegram Bot API and records every call. `failFor` chat ids get 403. */
async function readMultipart(init: RequestInit): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { multipart: true };
  try {
    const form = await new Request('https://tg.test/', {
      method: 'POST',
      headers: init.headers,
      body: init.body,
    }).formData();
    for (const [key, value] of form.entries()) {
      if (typeof value !== 'string') out[key] = { upload: true };
      else if (key === 'chat_id') out[key] = Number(value);
      else if (key === 'reply_markup') out[key] = JSON.parse(value);
      else out[key] = value;
    }
    // grammY sends `photo: "attach://<field>"` with the file in that field.
    for (const [key, value] of Object.entries(out))
      if (typeof value === 'string' && value.startsWith('attach://')) out[key] = { upload: true };
  } catch {
    // Unreadable: recorded as a bare upload.
  }
  return out;
}

export function mockTelegram({
  failFor = [] as number[],
  failMethods = [] as string[],
} = {}): TgCall[] {
  const calls: TgCall[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = url.pathname.split('/').pop()!;
    // File uploads (sendPhoto/sendDocument) are multipart: fields are read, files noted as uploads.
    const body: Record<string, unknown> =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : init?.body
          ? await readMultipart(init)
          : {};
    calls.push({ method, body });
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    if (failFor.includes(Number(body.chat_id))) {
      return json({
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      });
    }
    if (failMethods.includes(method)) {
      return json({ ok: false, error_code: 400, description: 'Bad Request: not enough rights' });
    }
    let result: unknown = true;
    if (method === 'createChatInviteLink') {
      result = {
        invite_link: `https://t.me/+inv${body.chat_id}`,
        creator: { id: 999, is_bot: true, first_name: 'TestBot' },
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
      };
    } else if (method === 'getMe') {
      result = {
        id: 999,
        is_bot: true,
        first_name: 'TestBot',
        username: 'test_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
      };
    } else if (method === 'sendMessage') {
      result = {
        message_id: ++messageSeq,
        date: 0,
        chat: { id: body.chat_id, type: 'private' },
        text: body.text,
      };
    }
    return json({ ok: true, result });
  });
  return calls;
}

// ---------- Bot updates ----------

let updateSeq = 1;

function tgFrom(user: FakeTgUser) {
  return {
    id: user.id,
    is_bot: false,
    first_name: user.first_name,
    username: user.username,
    language_code: 'ru',
  };
}

/** Header value Telegram would send for the configured secret. */
export const webhookHeader = () => deriveToken(env.WEBHOOK_SECRET, 'webhook');
export const setupHeader = () => deriveToken(env.WEBHOOK_SECRET, 'setup');

async function postUpdate(update: Record<string, unknown>) {
  return api('/bot/webhook', {
    method: 'POST',
    json: { update_id: ++updateSeq, ...update },
    headers: { 'X-Telegram-Bot-Api-Secret-Token': await webhookHeader() },
  });
}

export function sendText(user: FakeTgUser, text: string) {
  const command = text.startsWith('/') ? text.split(' ')[0]! : null;
  return postUpdate({
    message: {
      message_id: ++messageSeq,
      date: Math.floor(Date.now() / 1000),
      chat: { id: user.id, type: 'private', first_name: user.first_name },
      from: tgFrom(user),
      text,
      entities: command ? [{ type: 'bot_command', offset: 0, length: command.length }] : undefined,
    },
  });
}

export function pressButton(user: FakeTgUser, data: string) {
  return postUpdate({
    callback_query: {
      id: String(++updateSeq),
      from: tgFrom(user),
      chat_instance: '1',
      data,
      message: {
        message_id: ++messageSeq,
        date: Math.floor(Date.now() / 1000),
        chat: { id: user.id, type: 'private', first_name: user.first_name },
        text: 'card',
      },
    },
  });
}

/** Unique fake Telegram ids per test to avoid collisions in the shared test database. */
let idSeq = 50_000;
export function fakeUser(firstName: string, extra: Partial<FakeTgUser> = {}): FakeTgUser {
  return { id: ++idSeq, first_name: firstName, ...extra };
}

export const ADMIN: FakeTgUser = { id: 1001, first_name: 'Админ' };

export function callsTo(calls: TgCall[], method: string, chatId?: number) {
  return calls.filter(
    (c) => c.method === method && (chatId === undefined || c.body.chat_id === chatId),
  );
}

/** "/start <payload>" typed in a group chat (what Telegram sends after ?startgroup=). */
export function sendGroupCommand(
  user: FakeTgUser,
  chat: { id: number; title: string },
  text: string,
) {
  const command = text.split(' ')[0]!;
  return postUpdate({
    message: {
      message_id: ++messageSeq,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chat.id, type: 'supergroup', title: chat.title },
      from: tgFrom(user),
      text,
      entities: [{ type: 'bot_command', offset: 0, length: command.length }],
    },
  });
}

export function sendJoinRequest(user: FakeTgUser, chat: { id: number; title: string }) {
  return postUpdate({
    chat_join_request: {
      chat: { id: chat.id, type: 'supergroup', title: chat.title },
      from: tgFrom(user),
      user_chat_id: user.id,
      date: Math.floor(Date.now() / 1000),
    },
  });
}

export function sendBotPromoted(chat: { id: number; title: string }, by: FakeTgUser) {
  const bot = { id: 999, is_bot: true, first_name: 'TestBot', username: 'test_bot' };
  return postUpdate({
    my_chat_member: {
      chat: { id: chat.id, type: 'supergroup', title: chat.title },
      from: tgFrom(by),
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { user: bot, status: 'member' },
      new_chat_member: {
        user: bot,
        status: 'administrator',
        can_be_edited: false,
        is_anonymous: false,
        can_manage_chat: true,
        can_delete_messages: false,
        can_manage_video_chats: false,
        can_restrict_members: true,
        can_promote_members: false,
        can_change_info: false,
        can_invite_users: true,
        can_post_stories: false,
        can_edit_stories: false,
        can_delete_stories: false,
      },
    },
  });
}
