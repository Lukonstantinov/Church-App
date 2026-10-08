import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { messages, type TestAsInput, type TestAsOptions } from '@church/shared';
import { isDeveloper, type Env } from '../env';
import type { Db } from '../db/client';
import { groups, memberships, positions, users, type User } from '../db/schema';
import { churchDefaultLocale, localeOf } from './church';

/**
 * Trying the app as someone else. A developer (ADMIN_TELEGRAM_IDS) has one test person,
 * "🧪 Тестер", a real member with a real membership, so every screen and every right
 * check works exactly as for that kind of person. While `testAs` is set on the developer,
 * the app (not the bot) works as the test person; messages "to me" still reach the
 * developer's chat because the test person borrows their Telegram id for the request.
 */

/** The user the app works as for this request: the test person while testing. */
export async function testPersonFor(db: Db, env: Env, real: User): Promise<User> {
  if (!real.testAs || !isDeveloper(env, real)) return real;
  const persona = await db.query.users.findFirst({
    where: and(eq(users.id, real.testAs), eq(users.testOf, real.id)),
  });
  if (!persona) return real;
  return { ...persona, telegramId: real.telegramId, isReachable: real.isReachable };
}

/** What can be tried: every ministry with its positions, and what is tried now. */
export async function testOptions(db: Db, dev: User): Promise<TestAsOptions> {
  const [list, posList] = await Promise.all([
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(isNull(groups.archivedAt))
      .orderBy(asc(groups.name)),
    db
      .select({
        id: positions.id,
        groupId: positions.groupId,
        name: positions.name,
        permissions: positions.permissions,
      })
      .from(positions)
      .orderBy(asc(positions.sort), asc(positions.id)),
  ]);
  return {
    current: dev.testAs ? await currentLabel(db, dev) : null,
    groups: list.map((g) => ({
      ...g,
      positions: posList
        .filter((p) => p.groupId === g.id)
        .map((p) => ({ id: p.id, name: p.name, rights: p.permissions.length })),
    })),
  };
}

/** The developer's test person, made on first use. */
async function personaOf(db: Db, dev: User): Promise<User> {
  const found = await db.query.users.findFirst({ where: eq(users.testOf, dev.id) });
  if (found) return found;
  const t = messages(localeOf(dev, await churchDefaultLocale(db)));
  const [row] = await db
    .insert(users)
    .values({
      firstName: t.testAs.personName,
      locale: dev.locale,
      testOf: dev.id,
      // No privacy question for a test person; no Telegram account of its own.
      privacyAcceptedAt: new Date().toISOString(),
      isReachable: false,
    })
    .returning();
  return row!;
}

/**
 * Starts (or switches) testing: the test person gets exactly the chosen place — one
 * membership, or none, or church admin — and the app opens as them.
 */
export async function startTesting(db: Db, dev: User, input: TestAsInput): Promise<string> {
  const persona = await personaOf(db, dev);
  const now = new Date().toISOString();
  let groupId: number | null = null;
  let positionId: number | null = null;
  if (input.kind === 'position') {
    const pos = await db.query.positions.findFirst({ where: eq(positions.id, input.positionId) });
    if (!pos) throw new Error('position_not_found');
    groupId = pos.groupId;
    positionId = pos.id;
  } else if (input.kind === 'member' || input.kind === 'pending') {
    groupId = input.groupId;
  }
  // Leave every other ministry, so only the chosen place counts.
  await db
    .update(memberships)
    .set({ status: 'left', leftAt: now })
    .where(
      and(
        eq(memberships.userId, persona.id),
        groupId === null ? undefined : ne(memberships.groupId, groupId),
      ),
    );
  if (groupId !== null) {
    const status = input.kind === 'pending' ? 'pending' : 'active';
    await db
      .insert(memberships)
      .values({
        userId: persona.id,
        groupId,
        role: 'member',
        status,
        positionId,
        joinedAt: status === 'active' ? now : null,
      })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.groupId],
        set: { role: 'member', status, positionId, joinedAt: now, leftAt: null },
      });
  }
  await db
    .update(users)
    .set({ isAdmin: input.kind === 'admin', locale: dev.locale })
    .where(eq(users.id, persona.id));
  await db.update(users).set({ testAs: persona.id }).where(eq(users.id, dev.id));
  return currentLabel(db, { ...dev, testAs: persona.id });
}

/**
 * Back to being themselves. The test person leaves its ministries, so it disappears from
 * member lists until the next test.
 */
export async function stopTesting(db: Db, dev: User): Promise<void> {
  await db.update(users).set({ testAs: null }).where(eq(users.id, dev.id));
  const persona = await db.query.users.findFirst({ where: eq(users.testOf, dev.id) });
  if (!persona) return;
  await db
    .update(memberships)
    .set({ status: 'left', leftAt: new Date().toISOString() })
    .where(and(eq(memberships.userId, persona.id), ne(memberships.status, 'left')));
  await db.update(users).set({ isAdmin: false }).where(eq(users.id, persona.id));
}

/** "Дизайнер · Молодежка", "Администратор церкви"… — what the developer is trying now. */
export async function currentLabel(db: Db, dev: User): Promise<string> {
  const persona = dev.testAs
    ? await db.query.users.findFirst({ where: eq(users.id, dev.testAs) })
    : null;
  const t = messages(localeOf(dev, await churchDefaultLocale(db)));
  if (!persona) return t.testAs.newcomer;
  const rows = await db
    .select({
      groupName: groups.name,
      status: memberships.status,
      positionName: positions.name,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(eq(memberships.userId, persona.id));
  return testLabel(t, persona.isAdmin, rows);
}

/** The label from the test person's memberships (also used by /me). */
export function testLabel(
  t: ReturnType<typeof messages>,
  isAdmin: boolean,
  rows: { groupName: string; status: string; positionName: string | null }[],
): string {
  if (isAdmin) return t.testAs.admin;
  const active = rows.find((r) => r.status === 'active');
  if (active) return `${active.positionName ?? t.testAs.member} · ${active.groupName}`;
  const pending = rows.find((r) => r.status === 'pending');
  if (pending) return `${t.testAs.pending} · ${pending.groupName}`;
  return t.testAs.newcomer;
}
