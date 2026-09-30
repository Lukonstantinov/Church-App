import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { announcementComments, announcements, feedReads, memberships } from '../db/schema';

/**
 * Unread counters per ministry for one person: posts and chat messages (comments)
 * by others that arrived after the last time they opened the feed — or, if they never
 * have, after they joined.
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
          and c.id > coalesce(${feedReads.lastCommentId}, 0)
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

export async function markFeedRead(db: Db, userId: number, groupId: number) {
  const [post] = await db
    .select({ id: sql<number>`coalesce(max(${announcements.id}), 0)` })
    .from(announcements)
    .where(eq(announcements.groupId, groupId));
  const [comment] = await db
    .select({ id: sql<number>`coalesce(max(${announcementComments.id}), 0)` })
    .from(announcementComments)
    .innerJoin(announcements, eq(announcements.id, announcementComments.announcementId))
    .where(eq(announcements.groupId, groupId));
  const lastPostId = Number(post?.id ?? 0);
  const lastCommentId = Number(comment?.id ?? 0);
  await db
    .insert(feedReads)
    .values({ userId, groupId, lastPostId, lastCommentId })
    .onConflictDoUpdate({
      target: [feedReads.userId, feedReads.groupId],
      set: { lastPostId, lastCommentId },
    });
}
