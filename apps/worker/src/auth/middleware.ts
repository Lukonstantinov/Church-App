import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { adminTelegramIds, type Env } from '../env';
import { getDb, type Db } from '../db/client';
import type { User } from '../db/schema';
import { testPersonFor } from '../lib/testing';
import { upsertTelegramUser } from '../lib/users';
import { InitDataValidationError, validateInitData } from './initData';

export interface AuthVariables {
  db: Db;
  /** Who the app works as: the person, or a developer's test person while they test. */
  user: User;
  /** The person who actually signed in (the developer while testing; else `user`). */
  realUser: User;
}

/**
 * Requires `Authorization: tma <initDataRaw>`. The user identity comes only from
 * the signed initData, never from request bodies or query params.
 */
export const requireTelegramAuth = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const [scheme, raw] = header.split(' ', 2) as [string, string | undefined];
    if (scheme !== 'tma' || !raw) {
      throw new HTTPException(401, { message: 'missing_init_data' });
    }
    let validated;
    try {
      validated = await validateInitData(raw, c.env.BOT_TOKEN);
    } catch (e) {
      if (e instanceof InitDataValidationError) {
        throw new HTTPException(401, { message: e.code });
      }
      throw e;
    }
    const db = getDb(c.env.DB);
    const real = await upsertTelegramUser(db, validated.user, adminTelegramIds(c.env));
    c.set('db', db);
    c.set('realUser', real);
    c.set('user', await testPersonFor(db, c.env, real));
    await next();
  },
);
