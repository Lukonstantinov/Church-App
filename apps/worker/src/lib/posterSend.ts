import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { PosterAudience } from '@church/shared';
import type { Db } from '../db/client';
import { groups, memberships, users, type EventRow as Event, type Meeting } from '../db/schema';
import { eventRoster } from './eventRoster';
import { meetingRosterLines } from './meetingRoster';
import { churchDefaultLocale } from './church';

/**
 * Who gets a moving poster sent to others (the people who can get bot messages):
 * chosen members of the ministry, the whole ministry, everyone in the church, or only
 * those serving at this event / meeting. The sender is left out (they get it first).
 */
export async function posterRecipients(
  db: Db,
  args: {
    audience: Exclude<PosterAudience, 'me'>;
    kind: 'event' | 'meeting';
    item: Event | Meeting;
    userIds: number[];
    senderId: number;
    senderChatId: number;
  },
): Promise<{ userId: number; chatId: number }[]> {
  let ids: number[] | null = null;
  if (args.audience === 'serving') {
    if (args.kind === 'event') {
      const roster = await eventRoster(db, args.item.id);
      ids = roster.flatMap((r) => [
        ...(r.leaderId !== null ? [r.leaderId] : []),
        ...r.people.map((p) => p.id),
      ]);
    } else {
      ids = (await meetingRosterLines(db, args.item as Meeting, await churchDefaultLocale(db)))
        .userIds;
    }
    if (ids.length === 0) return [];
  }
  const rows = await db
    .selectDistinct({ userId: users.id, chatId: users.telegramId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(
      and(
        eq(memberships.status, 'active'),
        isNull(groups.archivedAt),
        isNotNull(users.telegramId),
        eq(users.isReachable, true),
        // The whole church: every ministry; otherwise this one.
        args.audience === 'church' ? undefined : eq(memberships.groupId, args.item.groupId),
        args.audience === 'people'
          ? inArray(users.id, args.userIds.length ? args.userIds : [-1])
          : undefined,
        ids ? inArray(users.id, ids) : undefined,
      ),
    );
  return rows
    .filter(
      (r) => r.userId !== args.senderId && r.chatId !== null && r.chatId !== args.senderChatId,
    )
    .map((r) => ({ userId: r.userId, chatId: r.chatId! }));
}
