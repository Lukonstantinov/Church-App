import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import {
  displayName,
  messages,
  readBackdrop,
  readPattern,
  type AnnouncementResult,
  type AnnouncementRow,
  type CommentRow,
  type CreateAnnouncementInput,
  type PosterLook,
} from '@church/shared';
import type { Db } from '../db/client';
import {
  announcementComments,
  announcementReactions,
  announcements,
  designTemplates,
  groups,
  memberships,
  users,
  type Group,
  type User,
} from '../db/schema';
import { audit } from './audit';
import { churchDefaultLocale, localeOf } from './church';
import { groupLogoUrl } from './groups';
import { unreadByPost } from './feed';
import { escapeHtml } from './html';
import { signedMediaUrl } from './media';
import { enqueue } from './outbox';

type AnnouncementDbRow = typeof announcements.$inferSelect;

/**
 * Saves a post (text, or a poster with headline, photos and tint) and, unless told
 * not to, queues a bot message to every active member who can receive one. With
 * photos the bot sends the first one with the text as its caption.
 */
export async function createAnnouncement(
  db: Db,
  args: {
    group: Group;
    author: User;
    input: Omit<CreateAnnouncementInput, 'notify'> & { notify?: boolean };
    appUrl: string | null;
    secret: string;
  },
): Promise<AnnouncementResult & { row: AnnouncementDbRow }> {
  const { group, author, input, appUrl } = args;
  const members = await db
    .select({
      id: users.id,
      chatId: users.telegramId,
      reachable: users.isReachable,
      locale: users.locale,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupId, group.id), eq(memberships.status, 'active')));

  const notify = input.notify ?? true;
  const others = members.filter((m) => m.id !== author.id);
  const reachable = notify ? others.filter((m) => m.chatId !== null && m.reachable) : [];
  const noTelegram = others.filter((m) => m.chatId === null).length;
  const unreachable = others.filter((m) => m.chatId !== null && !m.reachable).length;

  const [row] = await db
    .insert(announcements)
    .values({
      groupId: group.id,
      authorId: author.id,
      title: input.title ?? null,
      text: input.text,
      mediaIds: input.mediaIds?.length ? input.mediaIds : null,
      tintColor: input.tintColor ?? null,
      tintStrength: input.tintStrength ?? null,
      templateId: input.templateId ?? null,
      recipients: reachable.length,
    })
    .returning();
  await audit(db, {
    actorUserId: author.id,
    action: 'announcement_sent',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: { announcementId: row!.id, recipients: reachable.length },
  });

  const fallback = await churchDefaultLocale(db);
  const head = row!.title ? `<b>${escapeHtml(row!.title)}</b>\n` : '';
  const body = `📢 <b>${escapeHtml(group.name)}</b>\n\n${head}${escapeHtml(row!.text)}\n\n— ${escapeHtml(displayName(author))}`;
  const firstPhoto = row!.mediaIds?.[0];
  const photoUrl =
    firstPhoto && appUrl ? `${appUrl}${await signedMediaUrl(args.secret, firstPhoto)}` : null;
  for (const m of reachable) {
    const t = messages(localeOf(m, fallback));
    const reply_markup = appUrl ? new InlineKeyboard().webApp(t.bot.openApp, appUrl) : undefined;
    // Photo captions are limited to 1024 characters; longer posts go as a text message.
    const asPhoto = photoUrl && body.length <= 1024;
    await enqueue(db, {
      chatId: m.chatId!,
      method: asPhoto ? 'sendPhoto' : 'sendMessage',
      payload: asPhoto
        ? { chat_id: m.chatId, photo: photoUrl, caption: body, parse_mode: 'HTML', reply_markup }
        : {
            chat_id: m.chatId,
            text: body,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup,
          },
      dedupeKey: `ann:${row!.id}:${m.chatId}`,
    });
  }

  const [rendered] = await toRows(db, args.secret, author, [
    { a: row!, groupName: group.name, groupBrand: group, author },
  ]);
  return { announcement: rendered!, noTelegram, unreachable, row: row! };
}

interface RawRow {
  a: AnnouncementDbRow;
  groupName: string;
  groupBrand: {
    id: number;
    brandColor: string | null;
    pattern: string | null;
    textColor: string;
    logoMediaId: number | null;
    backdrop: string | null;
  };
  author: Pick<User, 'id' | 'firstName' | 'lastName'> | null;
}

/** Adds photos (signed URLs), reactions, comment counts and the poster look. */
async function toRows(
  db: Db,
  secret: string,
  viewer: User,
  rows: RawRow[],
  canModerate: (groupId: number) => boolean = () => false,
): Promise<AnnouncementRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.a.id);
  const templateIds = [
    ...new Set(rows.map((r) => r.a.templateId).filter((x): x is number => x !== null)),
  ];
  const [reactions, comments, templates, unread] = await Promise.all([
    db
      .select({
        announcementId: announcementReactions.announcementId,
        emoji: announcementReactions.emoji,
        n: sql<number>`count(*)`,
        mine: sql<number>`sum(case when ${announcementReactions.userId} = ${viewer.id} then 1 else 0 end)`,
      })
      .from(announcementReactions)
      .where(inArray(announcementReactions.announcementId, ids))
      .groupBy(announcementReactions.announcementId, announcementReactions.emoji),
    db
      .select({ announcementId: announcementComments.announcementId, n: sql<number>`count(*)` })
      .from(announcementComments)
      .where(
        and(
          inArray(announcementComments.announcementId, ids),
          isNull(announcementComments.deletedAt),
        ),
      )
      .groupBy(announcementComments.announcementId),
    templateIds.length
      ? db.select().from(designTemplates).where(inArray(designTemplates.id, templateIds))
      : Promise.resolve([]),
    unreadByPost(db, viewer.id, ids),
  ]);
  const templateBy = new Map(templates.map((tpl) => [tpl.id, tpl]));
  const commentsBy = new Map(comments.map((c) => [c.announcementId, Number(c.n)]));

  return Promise.all(
    rows.map(async ({ a, groupName, groupBrand, author }) => {
      const tpl = a.templateId ? templateBy.get(a.templateId) : undefined;
      const backdrop = readBackdrop(tpl ? tpl.backdrop : groupBrand.backdrop);
      const backdropUrl = backdrop ? await signedMediaUrl(secret, backdrop.mediaId) : null;
      const look: PosterLook = tpl
        ? {
            brandColor: tpl.brandColor,
            pattern: readPattern(tpl.pattern),
            textColor: tpl.textColor,
            logoUrl: tpl.logoMediaId ? await signedMediaUrl(secret, tpl.logoMediaId) : null,
            backdrop,
            backdropUrl,
          }
        : {
            brandColor: groupBrand.brandColor,
            pattern: readPattern(groupBrand.pattern),
            textColor: groupBrand.textColor,
            logoUrl: groupLogoUrl(groupBrand),
            backdrop,
            backdropUrl,
          };
      return {
        id: a.id,
        groupId: a.groupId,
        groupName,
        title: a.title,
        text: a.text,
        createdAt: a.createdAt,
        author: author
          ? { id: author.id, firstName: author.firstName, lastName: author.lastName }
          : null,
        recipients: a.recipients,
        photos: await Promise.all(
          (a.mediaIds ?? []).map(async (id) => ({ id, url: await signedMediaUrl(secret, id) })),
        ),
        tint:
          a.tintColor !== null ? { color: a.tintColor, strength: a.tintStrength ?? 0.35 } : null,
        look,
        reactions: reactions
          .filter((r) => r.announcementId === a.id)
          .map((r) => ({ emoji: r.emoji, count: Number(r.n), mine: Number(r.mine) > 0 })),
        commentCount: commentsBy.get(a.id) ?? 0,
        unreadComments: unread.get(a.id) ?? 0,
        pinned: a.pinnedAt !== null,
        canPin: canModerate(a.groupId),
        canDelete: author?.id === viewer.id || canModerate(a.groupId),
      };
    }),
  );
}

/** Newest first; `before` (a post id) pages back. */
export async function listAnnouncements(
  db: Db,
  args: {
    groupIds: number[];
    viewer: User;
    secret: string;
    limit?: number;
    before?: number;
    canModerate?: (groupId: number) => boolean;
    /** 'first': pinned posts lead the first page and are left out of the rest. */
    pinned?: 'first' | 'only';
  },
): Promise<AnnouncementRow[]> {
  if (args.groupIds.length === 0) return [];
  const pinnedOnly = args.pinned === 'only';
  const rows = await db
    .select({
      a: announcements,
      groupName: groups.name,
      groupBrand: {
        id: groups.id,
        brandColor: groups.brandColor,
        pattern: groups.pattern,
        textColor: groups.textColor,
        logoMediaId: groups.logoMediaId,
        backdrop: groups.backdrop,
      },
      author: { id: users.id, firstName: users.firstName, lastName: users.lastName },
    })
    .from(announcements)
    .innerJoin(groups, eq(groups.id, announcements.groupId))
    .leftJoin(users, eq(users.id, announcements.authorId))
    .where(
      and(
        inArray(announcements.groupId, args.groupIds),
        isNull(announcements.deletedAt),
        args.before ? lt(announcements.id, args.before) : undefined,
        pinnedOnly
          ? isNotNull(announcements.pinnedAt)
          : args.pinned === 'first'
            ? isNull(announcements.pinnedAt)
            : undefined,
      ),
    )
    .orderBy(pinnedOnly ? desc(announcements.pinnedAt) : desc(announcements.id))
    .limit(args.limit ?? 20);
  const pins =
    args.pinned === 'first' && !args.before
      ? await listAnnouncements(db, { ...args, pinned: 'only', limit: 10 })
      : [];
  return [
    ...pins,
    ...(await toRows(
      db,
      args.secret,
      args.viewer,
      rows.map((r) => ({ ...r, author: r.author?.id ? r.author : null })),
      args.canModerate,
    )),
  ];
}

/** Adds the reaction, or removes it when the person already reacted with that emoji. */
export async function toggleReaction(
  db: Db,
  announcementId: number,
  userId: number,
  emoji: string,
) {
  const existing = await db.query.announcementReactions.findFirst({
    where: and(
      eq(announcementReactions.announcementId, announcementId),
      eq(announcementReactions.userId, userId),
      eq(announcementReactions.emoji, emoji),
    ),
  });
  if (existing) {
    await db
      .delete(announcementReactions)
      .where(
        and(
          eq(announcementReactions.announcementId, announcementId),
          eq(announcementReactions.userId, userId),
          eq(announcementReactions.emoji, emoji),
        ),
      );
  } else {
    await db.insert(announcementReactions).values({ announcementId, userId, emoji });
  }
}

export async function listComments(
  db: Db,
  announcementId: number,
  viewer: User,
  canModerate: boolean,
): Promise<CommentRow[]> {
  const rows = await db
    .select({
      c: announcementComments,
      author: { id: users.id, firstName: users.firstName, lastName: users.lastName },
    })
    .from(announcementComments)
    .innerJoin(users, eq(users.id, announcementComments.userId))
    .where(
      and(
        eq(announcementComments.announcementId, announcementId),
        isNull(announcementComments.deletedAt),
      ),
    )
    .orderBy(announcementComments.id)
    .limit(300);
  return rows.map(({ c, author }) => ({
    id: c.id,
    text: c.text,
    createdAt: c.createdAt,
    author,
    mine: author.id === viewer.id,
    canDelete: author.id === viewer.id || canModerate,
  }));
}
