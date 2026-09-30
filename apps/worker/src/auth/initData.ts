/**
 * Validation of Telegram Mini App `initData`.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", msg = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, msg = data_check_string))
 *
 * data_check_string = every field except `hash`, sorted by key, "key=value" joined by "\n".
 */

import { timingSafeEqualStr } from '../lib/crypto';

export interface TelegramInitUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}

export interface ValidInitData {
  user: TelegramInitUser;
  authDate: number;
  startParam: string | null;
}

export type InitDataError = 'missing_hash' | 'bad_hash' | 'expired' | 'missing_user' | 'malformed';

export class InitDataValidationError extends Error {
  constructor(public readonly code: InitDataError) {
    super(`initData invalid: ${code}`);
  }
}

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signInitData(
  fields: Record<string, string>,
  botToken: string,
): Promise<string> {
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  return toHex(await hmac(secret, dataCheckString));
}

/**
 * Validates raw initData and returns the verified user.
 * @param maxAgeSeconds reject data older than this (default 24h)
 */
export async function validateInitData(
  raw: string,
  botToken: string,
  { maxAgeSeconds = 86_400, now = Date.now() }: { maxAgeSeconds?: number; now?: number } = {},
): Promise<ValidInitData> {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) throw new InitDataValidationError('missing_hash');

  const fields: Record<string, string> = {};
  for (const [k, v] of params) if (k !== 'hash') fields[k] = v;

  const expected = await signInitData(fields, botToken);
  if (!timingSafeEqualStr(expected, hash.toLowerCase()))
    throw new InitDataValidationError('bad_hash');

  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate)) throw new InitDataValidationError('malformed');
  if (now / 1000 - authDate > maxAgeSeconds) throw new InitDataValidationError('expired');

  if (!fields.user) throw new InitDataValidationError('missing_user');
  let user: TelegramInitUser;
  try {
    user = JSON.parse(fields.user) as TelegramInitUser;
  } catch {
    throw new InitDataValidationError('malformed');
  }
  if (!Number.isSafeInteger(user.id) || typeof user.first_name !== 'string') {
    throw new InitDataValidationError('malformed');
  }

  return { user, authDate, startParam: fields.start_param ?? null };
}
