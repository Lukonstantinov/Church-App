import { env } from 'cloudflare:workers';
import { signInitData } from '../src/auth/initData';
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

export async function api(path: string, init: RequestInit & { user?: FakeTgUser } = {}) {
  const headers = new Headers(init.headers);
  if (init.user) headers.set('Authorization', `tma ${await makeInitData(init.user)}`);
  return app.request(`https://app.test${path}`, { ...init, headers }, env);
}
