import { Api, GrammyError } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Env } from '../env';
import { DEEP_LINK } from './codes';

/** getMe result cached per isolate so it costs one API call per cold start, not per request. */
let cached: { token: string; info: UserFromGetMe } | undefined;

export async function getBotInfo(env: Env): Promise<UserFromGetMe> {
  if (cached?.token === env.BOT_TOKEN) return cached.info;
  const info = await new Api(env.BOT_TOKEN).getMe();
  cached = { token: env.BOT_TOKEN, info };
  return info;
}

export async function botUsername(env: Env): Promise<string> {
  return env.BOT_USERNAME || (await getBotInfo(env)).username;
}

export function botApi(env: Env): Api {
  return new Api(env.BOT_TOKEN);
}

export function inviteLink(botUsername: string, inviteCode: string): string {
  return `https://t.me/${botUsername}?start=${DEEP_LINK.join}${inviteCode}`;
}

export function claimLink(botUsername: string, claimCode: string): string {
  return `https://t.me/${botUsername}?start=${DEEP_LINK.claim}${claimCode}`;
}

/** True when Telegram says we can never message this chat (user blocked the bot, etc). */
export function isUnreachableError(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    (err.error_code === 403 || (err.error_code === 400 && /chat not found/i.test(err.description)))
  );
}

/** Public origin of the Mini App: APP_URL (custom domain) or the Worker's own origin. */
export function appUrlFor(env: Env, requestUrl: string): string {
  return env.APP_URL ?? new URL(requestUrl).origin;
}
