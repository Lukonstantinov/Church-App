import { Hono } from 'hono';
import { readNotificationsSchema } from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { listNotifications, markNotificationsRead } from '../lib/notifications';
import { parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** /api/me/notifications: what the person was told, newest first. */
export const notificationRoutes = new Hono<App>();

notificationRoutes.get('/', async (c) =>
  c.json(await listNotifications(c.get('db'), c.get('user').id)),
);

notificationRoutes.post('/read', async (c) => {
  const { ids } = await parseBody(c, readNotificationsSchema);
  await markNotificationsRead(c.get('db'), c.get('user').id, ids);
  return c.json({ ok: true });
});
