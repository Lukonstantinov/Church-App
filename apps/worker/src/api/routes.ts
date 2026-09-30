import { Hono } from 'hono';
import type { Env } from '../env';
import { requireTelegramAuth, type AuthVariables } from '../auth/middleware';
import { loadMe } from '../lib/users';
import { groupRoutes } from './groups';
import { membershipRoutes, userRoutes } from './members';

export const apiRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

apiRoutes.use('*', requireTelegramAuth);

apiRoutes.get('/me', async (c) => {
  return c.json(await loadMe(c.get('db'), c.get('user')));
});

apiRoutes.route('/groups', groupRoutes);
apiRoutes.route('/memberships', membershipRoutes);
apiRoutes.route('/users', userRoutes);
