import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AuthVariables } from '../auth/middleware';
import type { Env } from '../env';
import { drainOutbox } from '../lib/outbox';
import { decidePublish } from '../lib/publishRequests';
import { appUrlFor, botApi } from '../lib/telegram';
import { idParam } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** /api/publish-requests/:id/send | decline — an approver's answer from the app. */
export const publishRequestRoutes = new Hono<App>();

for (const action of ['send', 'decline'] as const)
  publishRequestRoutes.post(`/:id/${action}`, async (c) => {
    const db = c.get('db');
    const result = await decidePublish(db, {
      id: idParam(c),
      approver: c.get('user'),
      approve: action === 'send',
      envAppUrl: c.env.APP_URL,
      fallbackUrl: appUrlFor(c.env, c.req.url),
    });
    if (result.kind === 'not_allowed') throw new HTTPException(403, { message: 'forbidden' });
    if (result.kind === 'gone') throw new HTTPException(404, { message: 'not_found' });
    if (result.kind === 'handled') throw new HTTPException(409, { message: 'handled' });
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 100 }).catch((err) =>
        console.error('publish drain', err),
      ),
    );
    return c.json(result.kind === 'sent' ? { sent: result.total } : { sent: 0 });
  });
