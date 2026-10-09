import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  clientErrorSchema,
  mockPeopleSchema,
  testAsSchema,
  type MockPeopleInfo,
  type Telemetry,
} from '@church/shared';
import { isDeveloper, type Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import {
  attendance,
  churchSettings,
  clientErrors,
  groups,
  jobRuns,
  media,
  memberships,
  outbox,
  positions,
  users,
} from '../db/schema';
import { defaultPositionId } from '../lib/positions';
import { startTesting, stopTesting, testOptions } from '../lib/testing';
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

// ---------- Trying the app as another role (lib/testing.ts) ----------

/** Only the developer who signed in (not their test person) may switch roles. */
function developerOf(c: Context<App>) {
  const real = c.get('realUser');
  if (!isDeveloper(c.env, real)) throw new HTTPException(403, { message: 'forbidden' });
  return real;
}

devRoutes.get('/test-as', async (c) => c.json(await testOptions(c.get('db'), developerOf(c))));

devRoutes.post('/test-as', async (c) => {
  const dev = developerOf(c);
  const input = await parseBody(c, testAsSchema);
  const db = c.get('db');
  if (input.kind === 'member' || input.kind === 'pending') {
    const group = await db.query.groups.findFirst({ where: eq(groups.id, input.groupId) });
    if (!group) throw new HTTPException(404, { message: 'group_not_found' });
  }
  if (input.kind === 'position') {
    const pos = await db.query.positions.findFirst({ where: eq(positions.id, input.positionId) });
    if (!pos) throw new HTTPException(404, { message: 'position_not_found' });
  }
  return c.json({ label: await startTesting(db, dev, input) });
});

devRoutes.delete('/test-as', async (c) => {
  const dev = developerOf(c);
  await stopTesting(c.get('db'), dev);
  return c.json({ ok: true });
});

// ---------- Made-up people for trying birthdays and statistics ----------

/**
 * GET /api/dev/mock-people — how many made-up people there are, whether birthdays count
 * only them, and the ministries to add them to. The developer only (their real self).
 */
devRoutes.get('/mock-people', async (c) => {
  developerOf(c);
  const db = c.get('db');
  const [n] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.isMock, true));
  const church = await db.query.churchSettings.findFirst({ columns: { mockOnly: true } });
  const list = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(isNull(groups.archivedAt))
    .orderBy(groups.sort, groups.name);
  const info: MockPeopleInfo = {
    count: Number(n?.n ?? 0),
    mockOnly: church?.mockOnly ?? false,
    groups: list,
  };
  return c.json(info);
});

/**
 * POST /api/dev/mock-people — adds pasted people to a ministry as offline members marked
 * made-up (`users.is_mock`), with their birthdays and, when a position of that name exists
 * there, that position.
 */
devRoutes.post('/mock-people', async (c) => {
  developerOf(c);
  const db = c.get('db');
  const input = await parseBody(c, mockPeopleSchema);
  const group = await db.query.groups.findFirst({ where: eq(groups.id, input.groupId) });
  if (!group) throw new HTTPException(404, { message: 'group_not_found' });
  const posList = await db.select().from(positions).where(eq(positions.groupId, group.id));
  const byName = new Map(posList.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const fallback = await defaultPositionId(db, group.id);
  const now = new Date().toISOString();
  for (const p of input.people) {
    const [u] = await db
      .insert(users)
      .values({
        firstName: p.firstName,
        lastName: p.lastName,
        birthday: p.birthday,
        birthYear: p.birthYear,
        isMock: true,
      })
      .returning({ id: users.id });
    await db.insert(memberships).values({
      userId: u!.id,
      groupId: group.id,
      role: 'member',
      status: 'active',
      joinedAt: now,
      positionId: (p.role && byName.get(p.role.toLowerCase())) || fallback,
    });
  }
  return c.json({ added: input.people.length });
});

/** PATCH /api/dev/mock-people {mockOnly} — birthdays count only the made-up people, or the real. */
devRoutes.patch('/mock-people', async (c) => {
  developerOf(c);
  const { mockOnly } = await parseBody(c, z.object({ mockOnly: z.boolean() }));
  await c.get('db').update(churchSettings).set({ mockOnly }).where(eq(churchSettings.id, 1));
  return c.json({ ok: true });
});

/** DELETE /api/dev/mock-people — removes every made-up person (and goes back to the real ones). */
devRoutes.delete('/mock-people', async (c) => {
  developerOf(c);
  const db = c.get('db');
  const ids = (await db.select({ id: users.id }).from(users).where(eq(users.isMock, true))).map(
    (u) => u.id,
  );
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    await db.delete(attendance).where(inArray(attendance.userId, chunk));
    await db.delete(memberships).where(inArray(memberships.userId, chunk));
    await db.delete(users).where(inArray(users.id, chunk));
  }
  await db.update(churchSettings).set({ mockOnly: false }).where(eq(churchSettings.id, 1));
  return c.json({ removed: ids.length });
});
