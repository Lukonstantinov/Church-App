import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { createAnnouncementSchema } from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { groups, memberships } from '../db/schema';
import { assertCan, assertCanViewGroup } from '../lib/access';
import { createAnnouncement, listAnnouncements } from '../lib/announcements';
import { getAppUrl } from '../lib/church';
import { drainOutbox } from '../lib/outbox';
import { appUrlFor, botApi } from '../lib/telegram';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** /api/groups/:id/announcements */
export const groupAnnouncementRoutes = new Hono<App>();

groupAnnouncementRoutes.get('/:id/announcements', async (c) => {
  const db = c.get('db');
  const group = await assertCanViewGroup(db, c.get('user'), idParam(c));
  return c.json(await listAnnouncements(db, [group.id]));
});

groupAnnouncementRoutes.post('/:id/announcements', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'announce');
  const { text } = await parseBody(c, createAnnouncementSchema);
  const appUrl = (await getAppUrl(db, c.env.APP_URL)) ?? appUrlFor(c.env, c.req.url);
  const result = await createAnnouncement(db, { group, author: user, text, appUrl });
  // Send the first batch right away; the 5-minute cron sends anything left over.
  c.executionCtx.waitUntil(
    drainOutbox(db, botApi(c.env), { limit: 40 }).catch((err) =>
      console.error('announce drain', err),
    ),
  );
  return c.json(result, 201);
});

/** /api/me/announcements — recent announcements from the user's groups (member home). */
export const myAnnouncementRoutes = new Hono<App>();

myAnnouncementRoutes.get('/', async (c) => {
  const db = c.get('db');
  const rows = await db
    .select({ groupId: memberships.groupId })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(
      and(
        eq(memberships.userId, c.get('user').id),
        eq(memberships.status, 'active'),
        isNull(groups.archivedAt),
      ),
    );
  return c.json(
    await listAnnouncements(
      db,
      rows.map((r) => r.groupId),
      5,
    ),
  );
});
