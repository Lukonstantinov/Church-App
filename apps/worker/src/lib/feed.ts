import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  announcementComments,
  announcements,
  feedReads,
  memberships,
  postReads,
} from '../db/schema';

/**
 * Unread counters per ministry for one person: posts by others since they last opened
 * the feed, and comments by others under each post since they last opened that post —
 * never counting anything from before they joined.
 */
export async function unreadCounts(
  db: Db,
  userId: number,
  groupIds: number[],
): Promise<Map<number, { posts: number; comments: number }>> {
  const out = new Map<number, { posts: number; comments: number }>();
  if (groupIds.length === 0) return out;
  const rows = await db
    .select({
      groupId: memberships.groupId,
      posts: sql<number>`(
        select count(*) from ${announcements} a
        where a.group_id = ${memberships.groupId}
          and a.deleted_at is null
          and coalesce(a.author_id, 0) <> ${userId}
          and a.id > coalesce(${feedReads.lastPostId}, 0)
          and a.created_at > coalesce(${memberships.joinedAt}, ${memberships.createdAt})
      )`,
      comments: sql<number>`(
        select count(*) from ${announcementComments} c
        join ${announcements} a on a.id = c.announcement_id
        where a.group_id = ${memberships.groupId}
          and a.deleted_at is null
          and c.deleted_at is null
          and c.user_id <> ${userId}
          and c.id > max(
            coalesce(${feedReads.lastCommentId}, 0),
            coalesce((select pr.last_comment_id from ${postReads} pr
                      where pr.user_id = ${userId} and pr.announcement_id = a.id), 0)
          )
          and c.created_at > coalesce(${memberships.joinedAt}, ${memberships.createdAt})
      )`,
    })
    .from(memberships)
    .leftJoin(
      feedReads,
      and(eq(feedReads.userId, memberships.userId), eq(feedReads.groupId, memberships.groupId)),
    )
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
        inArray(memberships.groupId, groupIds),
      ),
    );
  for (const r of rows)
    out.set(r.groupId, { posts: Number(r.posts), comments: Number(r.comments) });
  return out;
}

/** Opening the feed: every post in it counts as seen (comments count per post). */
export async function markFeedRead(db: Db, userId: number, groupId: number) {
  const [post] = await db
    .select({ id: sql<number>`coalesce(max(${announcements.id}), 0)` })
    .from(announcements)
    .where(eq(announcements.groupId, groupId));
  const lastPostId = Number(post?.id ?? 0);
  await db
    .insert(feedReads)
    .values({ userId, groupId, lastPostId, lastCommentId: 0 })
    .onConflictDoUpdate({ target: [feedReads.userId, feedReads.groupId], set: { lastPostId } });
}

/** Opening a post: its comments so far count as seen. */
export async function markPostRead(db: Db, userId: number, announcementId: number) {
  const [row] = await db
    .select({ id: sql<number>`coalesce(max(${announcementComments.id}), 0)` })
    .from(announcementComments)
    .where(eq(announcementComments.announcementId, announcementId));
  const lastCommentId = Number(row?.id ?? 0);
  await db
    .insert(postReads)
    .values({ userId, announcementId, lastCommentId })
    .onConflictDoUpdate({
      target: [postReads.userId, postReads.announcementId],
      set: { lastCommentId },
    });
}

/** New comments by others under each of these posts, for one person. */
export async function unreadByPost(
  db: Db,
  userId: number,
  announcementIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (announcementIds.length === 0) return out;
  const rows = await db
    .select({ id: announcementComments.announcementId, n: sql<number>`count(*)` })
    .from(announcementComments)
    .innerJoin(announcements, eq(announcements.id, announcementComments.announcementId))
    .leftJoin(
      postReads,
      and(eq(postReads.announcementId, announcements.id), eq(postReads.userId, userId)),
    )
    .leftJoin(
      feedReads,
      and(eq(feedReads.groupId, announcements.groupId), eq(feedReads.userId, userId)),
    )
    .leftJoin(
      memberships,
      and(eq(memberships.groupId, announcements.groupId), eq(memberships.userId, userId)),
    )
    .where(
      and(
        inArray(announcementComments.announcementId, announcementIds),
        isNull(announcementComments.deletedAt),
        ne(announcementComments.userId, userId),
        sql`${announcementComments.id} > max(coalesce(${postReads.lastCommentId}, 0), coalesce(${feedReads.lastCommentId}, 0))`,
        sql`${announcementComments.createdAt} > coalesce(${memberships.joinedAt}, ${memberships.createdAt}, '')`,
      ),
    )
    .groupBy(announcementComments.announcementId);
  for (const r of rows) out.set(r.id, Number(r.n));
  return out;
}
