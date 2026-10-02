import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { NotificationKind, NotificationLink, NotificationRow } from '@church/shared';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';

/** Keeps a copy of what the bot sends (or couldn't send) so it can be read in the app. */
export async function recordNotification(
  db: Db,
  args: {
    userId: number;
    kind: NotificationKind;
    title: string;
    body: string;
    link?: NotificationLink | null;
  },
): Promise<void> {
  await db.insert(notifications).values({
    userId: args.userId,
    kind: args.kind,
    title: args.title.slice(0, 200),
    body: args.body.slice(0, 2000),
    link: args.link ? JSON.stringify(args.link) : null,
  });
}

function parseLink(raw: string | null): NotificationLink | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NotificationLink;
  } catch {
    return null;
  }
}

export async function listNotifications(db: Db, userId: number) {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(notifications.id)
    .limit(5000);
  const recent = rows.slice(-100).reverse();
  const items: NotificationRow[] = recent.map((r) => {
    const link = parseLink(r.link);
    return {
      id: r.id,
      kind: r.kind as NotificationKind,
      title: r.title,
      body: r.body,
      link,
      createdAt: r.createdAt,
      read: r.readAt !== null,
    };
  });
  return { items, unread: rows.filter((r) => r.readAt === null).length };
}

export async function markNotificationsRead(db: Db, userId: number, ids?: number[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ...(ids && ids.length > 0 ? [inArray(notifications.id, ids)] : []),
      ),
    );
}

/** Old notifications are dropped after two months. */
export async function pruneNotifications(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - 60 * 864e5).toISOString();
  await db.delete(notifications).where(lt(notifications.createdAt, cutoff));
}
