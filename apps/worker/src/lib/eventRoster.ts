import { asc, eq, inArray } from 'drizzle-orm';
import { displayName, dutyColor, fingerprint, messages, type Locale } from '@church/shared';
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
 * The event's picture for the bot. With a cover photo, that photo itself — the poster the
 * phone draws from it could come out black on iPhones. The drawn poster (a JPEG the app
 * makes) only when there is no photo (a designed cover) or a poster template is chosen.
 */
export const eventPictureId = (
  event: Pick<Event, 'coverMediaId' | 'posterMediaId'> & Partial<Pick<Event, 'posterTemplateId'>>,
) =>
  event.posterTemplateId
    ? (event.posterMediaId ?? event.coverMediaId ?? null)
    : (event.coverMediaId ?? event.posterMediaId ?? null);

/**
 * What a recorded cover loop shows: the cover photo and its effects. Only a single photo
 * (no slideshow, no poster template) is recorded; texts stay live over it.
 */
export function coverLoopKey(
  e: Pick<Event, 'coverMediaId' | 'motion' | 'motionTune' | 'motionLayers'>,
): string {
  // The recorder's version: loops made before iPhones drew the cover photo (v2) left the
  // photo out, so they no longer count and the live effects show until recorded again.
  return fingerprint(
    JSON.stringify([LOOP_RECORDER, e.coverMediaId, e.motion, e.motionTune, e.motionLayers]),
  );
}

/** Raised when older recordings of covers are known to be wrong. */
const LOOP_RECORDER = 2;

/** May the cover be recorded as a loop (a single photo with effects)? */
export const loopableCover = (
  e: Pick<Event, 'coverMediaId' | 'motion' | 'coverSlides' | 'posterTemplateId'>,
) => !!e.coverMediaId && !!e.motion && e.motion !== 'off' && !e.coverSlides && !e.posterTemplateId;

/** The recorded cover loop while it still shows the cover as it is. */
export function freshCoverLoop(e: Event): { mediaId: number } | null {
  if (!e.coverLoop || !loopableCover(e)) return null;
  try {
    const v = JSON.parse(e.coverLoop) as { mediaId?: number; key?: string };
    return v.mediaId && v.key === coverLoopKey(e) ? { mediaId: v.mediaId } : null;
  } catch {
    return null;
  }
}

/**
 * The event's moving picture for the bot: its recorded cover loop (the cover photo with its
 * effects; sent as an animation, playing like a GIF), when there is a current one.
 */
export const eventMovingId = (event: Event) => freshCoverLoop(event)?.mediaId ?? null;
