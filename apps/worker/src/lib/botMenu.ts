import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { messages, normalizePermissions } from '@church/shared';
import type { Api } from 'grammy';
import { commandsFor } from '../bot/bot';
import type { Db } from '../db/client';
import { memberships, positions, users } from '../db/schema';
import { adminTelegramIds, type Env } from '../env';
import { churchDefaultLocale, localeOf } from './church';

/**
 * Telegram shows a bot's command menu per chat. Everyone gets the standard one; the people
 * who may use /birthdays (church admins and those who manage people in a ministry) get it
 * added in their own chat, and developers also /testas. Done once a day per person
 * (`claim`), so a change of role shows within a day.
 */
export async function syncBirthdayMenus(
  db: Db,
  api: Pick<Api, 'setMyCommands'>,
  env: Pick<Env, 'ADMIN_TELEGRAM_IDS'>,
  claim: (userId: number) => Promise<boolean>,
): Promise<number> {
  const fallback = await churchDefaultLocale(db);
  const candidates = await db
    .select({
      id: users.id,
      chatId: users.telegramId,
      isAdmin: users.isAdmin,
      locale: users.locale,
    })
    .from(users)
    .where(and(isNotNull(users.telegramId), isNull(users.testOf), isNull(users.anonymizedAt)));
  // Who manages people somewhere: a position with the right, or a leader without a position.
  const managers = new Set<number>();
  const rows = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      permissions: positions.permissions,
    })
    .from(memberships)
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(eq(memberships.status, 'active'));
  for (const r of rows)
    if (
      r.permissions
        ? normalizePermissions(r.permissions).includes('people.manage')
        : r.role === 'leader'
    )
      managers.add(r.userId);
  const developers = adminTelegramIds(env as Env);
  let done = 0;
  for (const u of candidates) {
    if (!u.isAdmin && !managers.has(u.id)) continue;
    if (!(await claim(u.id))) continue;
    const t = messages(localeOf({ locale: u.locale }, fallback));
    const list = [
      ...commandsFor(t),
      { command: 'birthdays', description: t.commands.birthdays },
      ...(developers.has(u.chatId!) ? [{ command: 'testas', description: t.commands.testas }] : []),
    ];
    // A person who hasn't started the bot has no chat to set it in: skipped.
    await api
      .setMyCommands(list, { scope: { type: 'chat', chat_id: u.chatId! } })
      .then(() => void done++)
      .catch(() => undefined);
  }
  return done;
}
