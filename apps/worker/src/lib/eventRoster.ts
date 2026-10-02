import { asc, eq, inArray } from 'drizzle-orm';
import { displayName, dutyColor, messages, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import { eventRoleAssignees, eventRoles, users, type events } from '../db/schema';
import { escapeHtml, personLink } from './html';

type Event = typeof events.$inferSelect;

/** Every duty of an event in order, with its colour, its leader and the people on it. */
export async function eventRoster(db: Db, eventId: number) {
  const roles = await db
    .select()
    .from(eventRoles)
    .where(eq(eventRoles.eventId, eventId))
    .orderBy(asc(eventRoles.sort), asc(eventRoles.id));
  if (roles.length === 0) return [];
  const assignees = await db
    .select({
      roleId: eventRoleAssignees.roleId,
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      telegramId: users.telegramId,
    })
    .from(eventRoleAssignees)
    .innerJoin(users, eq(users.id, eventRoleAssignees.userId))
    .where(
      inArray(
        eventRoleAssignees.roleId,
        roles.map((r) => r.id),
      ),
    );
  const leaderIds = roles.map((r) => r.leaderUserId).filter((x): x is number => x !== null);
  const leaders = leaderIds.length
    ? await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
          telegramId: users.telegramId,
        })
        .from(users)
        .where(inArray(users.id, leaderIds))
    : [];
  return roles.map((r, i) => {
    const leader = leaders.find((l) => l.id === r.leaderUserId);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      color: dutyColor(i),
      leaderId: r.leaderUserId,
      leader: leader ? displayName(leader) : null,
      /** The name as a link to the person's Telegram (HTML). */
      leaderLink: leader ? personLink(displayName(leader), leader) : null,
      people: assignees
        .filter((a) => a.roleId === r.id && a.id !== r.leaderUserId)
        .map((a) => ({ id: a.id, name: displayName(a), link: personLink(displayName(a), a) })),
    };
  });
}

export type Roster = Awaited<ReturnType<typeof eventRoster>>;

/** "🔴 Техника — ★ Anna, Mark" lines (names link to their Telegram); empty without duties. */
export function rosterLines(roster: Roster, locale: Locale): string[] {
  const t = messages(locale).bot;
  return roster.map((r) => {
    const names = [...(r.leaderLink ? [`★ ${r.leaderLink}`] : []), ...r.people.map((p) => p.link)];
    return `${r.color.dot} <b>${escapeHtml(r.name)}</b> — ${
      names.length ? names.join(', ') : `<i>${t.rosterNone}</i>`
    }`;
  });
}

/** Who serves where, as one message. */
export function rosterMessage(event: Pick<Event, 'title'>, roster: Roster, locale: Locale) {
  const t = messages(locale).bot;
  const head = t.rosterTitle(escapeHtml(event.title));
  return roster.length
    ? `${head}\n\n${rosterLines(roster, locale).join('\n')}`
    : `${head}\n\n${t.rosterEmpty}`;
}

/**
 * The event's picture for the bot: the poster (a JPEG the app makes from the cover), else
 * the cover photo.
 */
export const eventPictureId = (event: Pick<Event, 'coverMediaId' | 'posterMediaId'>) =>
  event.posterMediaId ?? event.coverMediaId ?? null;
