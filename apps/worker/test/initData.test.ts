import { describe, expect, it } from 'vitest';
import { InitDataValidationError, signInitData, validateInitData } from '../src/auth/initData';

const TOKEN = '123456:TEST-TOKEN';
const user = { id: 42, first_name: 'Анна', username: 'anna' };

async function build(overrides: Record<string, string> = {}, token = TOKEN) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
    ...overrides,
  };
  const hash = await signInitData(fields, token);
  return new URLSearchParams({ ...fields, hash }).toString();
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof InitDataValidationError ? e.code : String(e);
  }
}

describe('validateInitData', () => {
  it('accepts correctly signed data and returns the user', async () => {
    const result = await validateInitData(await build({ start_param: 'roll_5' }), TOKEN);
    expect(result.user).toMatchObject({ id: 42, first_name: 'Анна' });
    expect(result.startParam).toBe('roll_5');
  });

  it('rejects data signed with another bot token', async () => {
    expect(await codeOf(validateInitData(await build({}, '999:OTHER'), TOKEN))).toBe('bad_hash');
  });

  it('rejects tampered fields', async () => {
    const raw = await build();
    const tampered = raw.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(tampered).not.toBe(raw);
    expect(await codeOf(validateInitData(tampered, TOKEN))).toBe('bad_hash');
  });

  it('rejects missing hash', async () => {
    const raw = new URLSearchParams({ auth_date: '1', user: '{}' }).toString();
    expect(await codeOf(validateInitData(raw, TOKEN))).toBe('missing_hash');
  });

  it('rejects expired data', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 2 * 86_400);
    expect(await codeOf(validateInitData(await build({ auth_date: old }), TOKEN))).toBe('expired');
  });

  it('rejects signed data without a user', async () => {
    const fields = { auth_date: String(Math.floor(Date.now() / 1000)) };
    const hash = await signInitData(fields, TOKEN);
    const raw = new URLSearchParams({ ...fields, hash }).toString();
    expect(await codeOf(validateInitData(raw, TOKEN))).toBe('missing_user');
  });
});
