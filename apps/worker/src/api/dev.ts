import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, desc, gte, isNotNull, sql } from 'drizzle-orm';
import { clientErrorSchema, type Telemetry } from '@church/shared';
import { isDeveloper, type Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { clientErrors, groups, jobRuns, media, outbox, users } from '../db/schema';
import { parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** Free-plan database size limit per D1 database. */
const D1_FREE_DB_BYTES = 500 * 1024 * 1024;

const TABLES = [
  'users',
  'groups',
  'memberships',
  'positions',
  'meetings',
  'attendance',
  'transactions',
  'events',
  'announcements',
  'announcement_comments',
  'media',
  'outbox',
  'audit_log',
] as const;

/** /api/dev/telemetry — usage and health numbers, for the people who run the app. */
export const devRoutes = new Hono<App>();

devRoutes.get('/telemetry', async (c) => {
  const user = c.get('user');
  if (!isDeveloper(c.env, user)) throw new HTTPException(403, { message: 'forbidden' });
  const db = c.get('db');
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const DAY = 86_400_000;

  // D1 reports the database size in the metadata of any query.
  const probe = await c.env.DB.prepare('select 1').run();
  const sizeBytes =
    typeof (probe.meta as { size_after?: number }).size_after === 'number'
      ? (probe.meta as { size_after: number }).size_after
      : null;

  const counts = await c.env.DB.batch(
    TABLES.map((t) => c.env.DB.prepare(`select count(*) as n from "${t}"`)),
  );

  const [mediaRows, userRow, groupRow, outboxRow, errors, jobs, crashes] = await Promise.all([
    db
      .select({
        kind: media.kind,
        count: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(${media.bytes}), 0)`,
      })
      .from(media)
      .groupBy(media.kind),
    db
      .select({
        total: sql<number>`count(*)`,
        withTelegram: sql<number>`sum(case when ${users.telegramId} is not null then 1 else 0 end)`,
        active1d: sql<number>`sum(case when ${users.lastSeenAt} >= ${ago(DAY)} then 1 else 0 end)`,
        active7d: sql<number>`sum(case when ${users.lastSeenAt} >= ${ago(7 * DAY)} then 1 else 0 end)`,
        active30d: sql<number>`sum(case when ${users.lastSeenAt} >= ${ago(30 * DAY)} then 1 else 0 end)`,
        blocked: sql<number>`sum(case when ${users.isReachable} = 0 then 1 else 0 end)`,
      })
      .from(users),
    db
      .select({
        total: sql<number>`count(*)`,
        archived: sql<number>`sum(case when ${groups.archivedAt} is not null then 1 else 0 end)`,
      })
      .from(groups),
    db
      .select({
        pending: sql<number>`sum(case when ${outbox.status} = 'pending' then 1 else 0 end)`,
        dead: sql<number>`sum(case when ${outbox.status} = 'dead' then 1 else 0 end)`,
        sent24h: sql<number>`sum(case when ${outbox.status} = 'sent' and ${outbox.createdAt} >= ${ago(DAY)} then 1 else 0 end)`,
      })
      .from(outbox),
    db
      .select({ method: outbox.method, error: outbox.lastError, at: outbox.createdAt })
      .from(outbox)
      .where(and(isNotNull(outbox.lastError), gte(outbox.createdAt, ago(7 * DAY))))
      .orderBy(desc(outbox.id))
      .limit(5),
    db
      .select({ job: jobRuns.job, lastRun: sql<string>`max(${jobRuns.ranAt})` })
      .from(jobRuns)
      .groupBy(jobRuns.job),
    db
      .select({
        message: clientErrors.message,
        place: clientErrors.place,
        device: clientErrors.userAgent,
        at: clientErrors.createdAt,
      })
      .from(clientErrors)
      .orderBy(desc(clientErrors.id))
      .limit(15),
  ]);
  const u = userRow[0]!;
  const g = groupRow[0]!;
  const o = outboxRow[0]!;
  const n = (v: unknown) => Number(v ?? 0);

  const body: Telemetry = {
    environment: c.env.ENVIRONMENT,
    generatedAt: new Date().toISOString(),
    database: { sizeBytes, limitBytes: D1_FREE_DB_BYTES },
    tables: TABLES.map((name, i) => ({
      name,
      rows: n((counts[i]?.results?.[0] as { n?: number } | undefined)?.n),
    })),
    media: mediaRows.map((m) => ({ kind: m.kind, count: n(m.count), bytes: n(m.bytes) })),
    users: {
      total: n(u.total),
      withTelegram: n(u.withTelegram),
      active1d: n(u.active1d),
      active7d: n(u.active7d),
      active30d: n(u.active30d),
      blockedBot: n(u.blocked),
    },
    ministries: { total: n(g.total), archived: n(g.archived) },
    bot: {
      pending: n(o.pending),
      sent24h: n(o.sent24h),
      dead: n(o.dead),
      recentErrors: errors.map((e) => ({ method: e.method, error: e.error, at: e.at })),
    },
    jobs: jobs.map((j) => ({ job: j.job, lastRun: j.lastRun })),
    clientErrors: crashes,
    limits: [
      { key: 'workers.requests', value: '100 000 / day' },
      { key: 'workers.cpu', value: '10 ms / request' },
      { key: 'workers.subrequests', value: '50 / request' },
      { key: 'workers.cron', value: '5 triggers / account' },
      { key: 'd1.storage', value: '500 MB / database, 5 GB total' },
      { key: 'd1.reads', value: '5 000 000 rows / day' },
      { key: 'd1.writes', value: '100 000 rows / day' },
      { key: 'assets', value: 'static files: free, unlimited requests' },
    ],
  };
  return c.json(body);
});

/**
 * POST /api/dev/client-error — any signed-in person's app reports an error it hit (a screen
 * that crashed). The same message from the same person within a minute is kept once, and
 * only the latest 200 are kept at all.
 */
devRoutes.post('/client-error', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const input = await parseBody(c, clientErrorSchema);
  const recent = await db
    .select({ id: clientErrors.id })
    .from(clientErrors)
    .where(
      and(
        sql`${clientErrors.userId} = ${user.id}`,
        sql`${clientErrors.message} = ${input.message}`,
        gte(clientErrors.createdAt, new Date(Date.now() - 60_000).toISOString()),
      ),
    )
    .limit(1);
  if (recent.length === 0) {
    await db.insert(clientErrors).values({
      userId: user.id,
      message: input.message,
      stack: input.stack ?? null,
      place: input.place ?? null,
      userAgent: input.userAgent ?? null,
    });
    await c.env.DB.prepare(
      'delete from client_errors where id <= (select max(id) - 200 from client_errors)',
    ).run();
  }
  return c.json({ ok: true });
});
