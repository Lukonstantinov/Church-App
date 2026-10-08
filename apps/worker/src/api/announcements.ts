import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  commentSchema,
  pinSchema,
  resendPostSchema,
  updateAnnouncementSchema,
  voteSchema,
  readPostBlocks,
  type UpdateAnnouncementInput,
  createAnnouncementSchema,
  reactionSchema,
  templateInputSchema,
  readBackdrop,
  readPattern,
  readSpeakerLook,
  readTunes,
  type DesignTemplate,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import {
  announcementComments,
  announcements,
  designTemplates,
  events,
  groups,
  media,
  memberships,
  pollVotes,
  users,
} from '../db/schema';
import {
  accessIn,
  assertCan,
  assertCanViewGroup,
  assertMayDesign,
  designRights,
  groupsWithPermission,
  lookDiffers,
} from '../lib/access';
import { assertGroupFile, storeFile } from '../lib/files';
import {
  contentColumns,
  createAnnouncement,
  referencedIds,
  listAnnouncements,
  listComments,
  queuePostMessages,
  toggleReaction,
} from '../lib/announcements';
import { audit } from '../lib/audit';
import { getAppUrl } from '../lib/church';
import { assertGroupMedia, signedFileUrl, signedMediaUrl } from '../lib/media';
import { markPostRead } from '../lib/feed';
import { readMotion } from '../lib/meetings';
import { drainOutbox } from '../lib/outbox';
import { appUrlFor, botApi } from '../lib/telegram';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** Everything a post refers to must belong to its ministry (templates are church-wide). */
async function assertContent(
  db: AuthVariables['db'],
  groupId: number,
  input: UpdateAnnouncementInput,
) {
  const refs = referencedIds(input);
  for (const id of refs.media) await assertGroupMedia(db, groupId, id);
  for (const id of refs.files) await assertGroupFile(db, groupId, id);
  if (input.eventId) {
    const ev = await db.query.events.findFirst({
      columns: { id: true },
      where: and(eq(events.id, input.eventId), eq(events.groupId, groupId)),
    });
    if (!ev) throw new HTTPException(400, { message: 'invalid_event' });
  }
  if (input.templateId) {
    const tpl = await db.query.designTemplates.findFirst({
      columns: { id: true },
      where: eq(designTemplates.id, input.templateId),
    });
    if (!tpl) throw new HTTPException(400, { message: 'invalid_template' });
  }
}

/** /api/groups/:id/announcements — the ministry's feed. */
export const groupAnnouncementRoutes = new Hono<App>();

groupAnnouncementRoutes.get('/:id/announcements', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanViewGroup(db, user, idParam(c));
  const moderate = (await accessIn(db, user, group.id)).perms.has('announce');
  const rights = await designRights(db, user, group.id);
  const before = Number(c.req.query('before')) || undefined;
  return c.json(
    await listAnnouncements(db, {
      groupIds: [group.id],
      viewer: user,
      secret: c.env.WEBHOOK_SECRET,
      before,
      canModerate: () => moderate,
      canDesign: (_g, canEdit) => rights.designer || (!rights.locked && canEdit),
      pinned: 'first',
    }),
  );
});

groupAnnouncementRoutes.post('/:id/announcements', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'announce');
  const input = await parseBody(c, createAnnouncementSchema);
  await assertContent(db, group.id, input);
  const appUrl = (await getAppUrl(db, c.env.APP_URL)) ?? appUrlFor(c.env, c.req.url);
  const { row: _row, ...result } = await createAnnouncement(db, {
    group,
    author: user,
    input,
    appUrl,
    secret: c.env.WEBHOOK_SECRET,
  });
  // Send the first batch right away; the 5-minute cron sends anything left over.
  if (input.notify) {
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 40 }).catch((err) =>
        console.error('announce drain', err),
      ),
    );
  }
  return c.json(result, 201);
});

/** Attach a document (PDF, office file, screenshot) to a post: raw body, ?name=file.pdf */
groupAnnouncementRoutes.post('/:id/files', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'announce');
  const row = await storeFile(db, c.req, {
    groupId: group.id,
    name: c.req.query('name') ?? '',
    userId: user.id,
  });
  return c.json(
    {
      id: row.id,
      name: row.name,
      bytes: row.bytes,
      mime: row.mime,
      url: await signedFileUrl(c.env.WEBHOOK_SECRET, row.id),
    },
    201,
  );
});

/** /api/me/announcements — recent posts from all the user's ministries (member home). */
export const myAnnouncementRoutes = new Hono<App>();

myAnnouncementRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const rows = await db
    .select({ groupId: memberships.groupId })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.status, 'active'),
        isNull(groups.archivedAt),
      ),
    );
  const moderated = new Set(await groupsWithPermission(db, user.id, 'announce'));
  const designs = new Set(await groupsWithPermission(db, user.id, 'design'));
  const locked =
    (await db.query.churchSettings.findFirst({ columns: { designLock: true } }))?.designLock ??
    false;
  return c.json(
    await listAnnouncements(db, {
      groupIds: rows.map((r) => r.groupId),
      viewer: user,
      secret: c.env.WEBHOOK_SECRET,
      limit: 5,
      pinned: 'first',
      canModerate: (g) => user.isAdmin || moderated.has(g),
      canDesign: (g, canEdit) => user.isAdmin || designs.has(g) || (!locked && canEdit),
    }),
  );
});

/** /api/announcements/:id — reactions, comments, deletion. Members of the ministry only. */
export const announcementRoutes = new Hono<App>();

async function loadPost(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const post = await db.query.announcements.findFirst({ where: eq(announcements.id, id) });
  if (!post || post.deletedAt) throw new HTTPException(404, { message: 'not_found' });
  const access = await accessIn(db, user, post.groupId);
  if (!access.member) throw new HTTPException(404, { message: 'not_found' });
  return { db, user, post, moderate: access.perms.has('announce') };
}

/** Pin or unpin: pinned posts lead the ministry's feed. */
announcementRoutes.post('/:id/pin', async (c) => {
  const { db, user, post, moderate } = await loadPost(c, idParam(c));
  if (!moderate) throw new HTTPException(403, { message: 'forbidden' });
  const { pinned } = await parseBody(c, pinSchema);
  await db
    .update(announcements)
    .set({ pinnedAt: pinned ? new Date().toISOString() : null })
    .where(eq(announcements.id, post.id));
  await audit(db, {
    actorUserId: user.id,
    action: pinned ? 'announcement_pinned' : 'announcement_unpinned',
    entity: 'group',
    entityId: post.groupId,
    groupId: post.groupId,
    data: { announcementId: post.id },
  });
  return c.json({ ok: true });
});

/**
 * Send the post's notification again (moderators and the author): to everyone in the
 * ministry or only chosen people. The message says it is a repeat and who sent it.
 */
announcementRoutes.post('/:id/resend', async (c) => {
  const { db, user, post, moderate } = await loadPost(c, idParam(c));
  if (post.authorId !== user.id && !moderate)
    throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, resendPostSchema);
  const group = (await db.query.groups.findFirst({ where: eq(groups.id, post.groupId) }))!;
  const author =
    (post.authorId
      ? await db.query.users.findFirst({ where: eq(users.id, post.authorId) })
      : undefined) ?? user;
  const chosen = input.userIds && input.userIds.length > 0 ? input.userIds : null;
  const rows = await db
    .select({
      id: users.id,
      chatId: users.telegramId,
      locale: users.locale,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.groupId, post.groupId),
        eq(memberships.status, 'active'),
        eq(users.isReachable, true),
        isNotNull(users.telegramId),
        ...(chosen ? [inArray(users.id, chosen)] : []),
      ),
    );
  await queuePostMessages(db, {
    group,
    author,
    row: post,
    targets: rows,
    appUrl: (await getAppUrl(db, c.env.APP_URL)) ?? appUrlFor(c.env, c.req.url),
    secret: c.env.WEBHOOK_SECRET,
    repeatedBy: user,
    text: input.text,
    poster: input.poster,
  });
  if (rows.length > 0)
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 100 }).catch((err) =>
        console.error('resend drain', err),
      ),
    );
  await audit(db, {
    actorUserId: user.id,
    action: 'announcement_resent',
    entity: 'group',
    entityId: post.groupId,
    groupId: post.groupId,
    data: { announcementId: post.id, sent: rows.length, chosen: chosen?.length ?? null },
  });
  return c.json({ sent: rows.length });
});

/** Edit a post (author or moderators). Members are not notified again. */
announcementRoutes.patch('/:id', async (c) => {
  const { db, user, post, moderate } = await loadPost(c, idParam(c));
  const canEdit = post.authorId === user.id || moderate;
  const rights = await designRights(db, user, post.groupId);
  // A designer may change only the look of a post they can't otherwise edit.
  if (!canEdit && !rights.designer) throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, updateAnnouncementSchema);
  await assertContent(db, post.groupId, input);
  const next = contentColumns(input);
  const look = ['tintColor', 'tintStrength', 'templateId', 'design'] as const;
  // Editing sends the whole post: only what actually changed counts. The poster picture
  // is drawn from the post on every save, so it isn't "the look".
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (k) => k !== 'posterMediaId' && lookDiffers(next[k], post[k]),
  );
  const isLook = (k: string) => (look as readonly string[]).includes(k);
  if (changed.some(isLook)) assertMayDesign(rights, canEdit);
  if (!canEdit && changed.some((k) => !isLook(k)))
    throw new HTTPException(403, { message: 'forbidden' });
  await db
    .update(announcements)
    .set({ ...next, editedAt: new Date().toISOString() })
    .where(eq(announcements.id, post.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'announcement_edited',
    entity: 'group',
    entityId: post.groupId,
    groupId: post.groupId,
    data: { announcementId: post.id },
  });
  return c.json({ ok: true });
});

/**
 * Answer a poll (changeable; several options when it allows) or a quiz (one answer,
 * final). Members of the ministry only.
 */
announcementRoutes.post('/:id/vote', async (c) => {
  const { db, user, post } = await loadPost(c, idParam(c));
  const { blockId, options } = await parseBody(c, voteSchema);
  const block = readPostBlocks(post.blocks).find((b) => b.id === blockId);
  if (!block || (block.type !== 'poll' && block.type !== 'quiz'))
    throw new HTTPException(404, { message: 'not_found' });
  const chosen = [...new Set(options)];
  if (chosen.some((o) => o >= block.options.length))
    throw new HTTPException(400, { message: 'invalid_option' });
  if ((block.type === 'quiz' || !block.multiple) && chosen.length !== 1)
    throw new HTTPException(400, { message: 'one_option' });
  const mine = and(
    eq(pollVotes.announcementId, post.id),
    eq(pollVotes.blockId, blockId),
    eq(pollVotes.userId, user.id),
  );
  if (block.type === 'quiz') {
    const answered = await db.query.pollVotes.findFirst({ where: mine });
    if (answered) throw new HTTPException(409, { message: 'already_answered' });
  } else {
    await db.delete(pollVotes).where(mine);
  }
  for (const option of chosen) {
    await db
      .insert(pollVotes)
      .values({ announcementId: post.id, blockId, userId: user.id, option });
  }
  return c.json({ ok: true });
});

/** Opening a post: its comments count as read. */
announcementRoutes.post('/:id/read', async (c) => {
  const { db, user, post } = await loadPost(c, idParam(c));
  await markPostRead(db, user.id, post.id);
  return c.json({ ok: true });
});

announcementRoutes.post('/:id/reactions', async (c) => {
  const { db, user, post } = await loadPost(c, idParam(c));
  const { emoji } = await parseBody(c, reactionSchema);
  await toggleReaction(db, post.id, user.id, emoji);
  return c.json({ ok: true });
});

announcementRoutes.get('/:id/comments', async (c) => {
  const { db, user, post, moderate } = await loadPost(c, idParam(c));
  return c.json(await listComments(db, post.id, user, moderate));
});

announcementRoutes.post('/:id/comments', async (c) => {
  const { db, user, post, moderate } = await loadPost(c, idParam(c));
  const { text } = await parseBody(c, commentSchema);
  await db.insert(announcementComments).values({ announcementId: post.id, userId: user.id, text });
  return c.json(await listComments(db, post.id, user, moderate), 201);
});

announcementRoutes.delete('/:id', async (c) => {
  const { db, user, post, moderate } = await loadPost(c, idParam(c));
  if (post.authorId !== user.id && !moderate)
    throw new HTTPException(403, { message: 'forbidden' });
  await db
    .update(announcements)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(announcements.id, post.id));
  return c.json({ ok: true });
});

/** /api/comments/:id — authors and moderators remove a comment. */
export const commentRoutes = new Hono<App>();

commentRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const comment = await db.query.announcementComments.findFirst({
    where: eq(announcementComments.id, idParam(c)),
  });
  if (!comment || comment.deletedAt) throw new HTTPException(404, { message: 'not_found' });
  const post = await db.query.announcements.findFirst({
    where: eq(announcements.id, comment.announcementId),
  });
  const moderate = post ? (await accessIn(db, user, post.groupId)).perms.has('announce') : false;
  if (comment.userId !== user.id && !moderate)
    throw new HTTPException(403, { message: 'forbidden' });
  await db
    .update(announcementComments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(announcementComments.id, comment.id));
  return c.json({ ok: true });
});

/**
 * /api/templates — church-wide design templates (colours, pattern, text colour).
 * Anyone who may change a ministry's look or post announcements can save them.
 */
export const templateRoutes = new Hono<App>();

export async function canDesign(c: { get: (k: 'db' | 'user') => unknown }) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  if (user.isAdmin) return true;
  const [a, b, d] = await Promise.all([
    groupsWithPermission(db, user.id, 'settings'),
    groupsWithPermission(db, user.id, 'announce'),
    groupsWithPermission(db, user.id, 'design'),
  ]);
  return a.length + b.length + d.length > 0;
}

templateRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!(await canDesign(c))) throw new HTTPException(403, { message: 'forbidden' });
  const rows = await db.select().from(designTemplates).orderBy(designTemplates.id);
  const list: DesignTemplate[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      brandColor: r.brandColor,
      pattern: readPattern(r.pattern),
      textColor: r.textColor,
      logoUrl: r.logoMediaId ? await signedMediaUrl(c.env.WEBHOOK_SECRET, r.logoMediaId) : null,
      backdrop: readBackdrop(r.backdrop),
      backdropUrl: readBackdrop(r.backdrop)
        ? await signedMediaUrl(c.env.WEBHOOK_SECRET, readBackdrop(r.backdrop)!.mediaId)
        : null,
      motion: readMotion(r.motion),
      tileMotion: readMotion(r.tileMotion),
      posterMotion: readMotion(r.posterMotion),
      motionTunes: readTunes(r.motionTunes),
      speakerLook: readSpeakerLook(r.speakerLook),
      mine: r.createdBy === user.id,
    })),
  );
  return c.json(list);
});

templateRoutes.post('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!(await canDesign(c))) throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, templateInputSchema);
  for (const id of [input.logoMediaId, input.backdrop?.mediaId]) {
    if (!id) continue;
    const m = await db.query.media.findFirst({ columns: { id: true }, where: eq(media.id, id) });
    if (!m) throw new HTTPException(400, { message: 'invalid_media' });
  }
  const [row] = await db
    .insert(designTemplates)
    .values({
      name: input.name,
      brandColor: input.brandColor,
      pattern: input.pattern ? JSON.stringify(input.pattern) : null,
      textColor: input.textColor,
      logoMediaId: input.logoMediaId ?? null,
      backdrop: input.backdrop ? JSON.stringify(input.backdrop) : null,
      motion: input.motion ?? null,
      tileMotion: input.tileMotion ?? null,
      posterMotion: input.posterMotion ?? null,
      motionTunes: input.motionTunes ? JSON.stringify(input.motionTunes) : null,
      speakerLook: input.speakerLook ? JSON.stringify(input.speakerLook) : null,
      createdBy: user.id,
    })
    .returning({ id: designTemplates.id });
  return c.json({ id: row!.id }, 201);
});

/** Change a template (its maker or a church admin); everything using it follows. */
templateRoutes.put('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const row = await db.query.designTemplates.findFirst({
    where: eq(designTemplates.id, idParam(c)),
  });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  if (row.createdBy !== user.id && !user.isAdmin)
    throw new HTTPException(403, { message: 'forbidden' });
  const input = await parseBody(c, templateInputSchema);
  for (const id of [input.logoMediaId, input.backdrop?.mediaId]) {
    if (!id) continue;
    const m = await db.query.media.findFirst({ columns: { id: true }, where: eq(media.id, id) });
    if (!m) throw new HTTPException(400, { message: 'invalid_media' });
  }
  await db
    .update(designTemplates)
    .set({
      name: input.name,
      brandColor: input.brandColor,
      pattern: input.pattern ? JSON.stringify(input.pattern) : null,
      textColor: input.textColor,
      logoMediaId: input.logoMediaId ?? null,
      backdrop: input.backdrop ? JSON.stringify(input.backdrop) : null,
      motion: input.motion ?? null,
      tileMotion: input.tileMotion ?? null,
      posterMotion: input.posterMotion ?? null,
      motionTunes: input.motionTunes ? JSON.stringify(input.motionTunes) : null,
      speakerLook: input.speakerLook ? JSON.stringify(input.speakerLook) : null,
    })
    .where(eq(designTemplates.id, row.id));
  return c.json({ id: row.id });
});

templateRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const row = await db.query.designTemplates.findFirst({
    where: eq(designTemplates.id, idParam(c)),
  });
  if (!row) throw new HTTPException(404, { message: 'not_found' });
  if (row.createdBy !== user.id && !user.isAdmin)
    throw new HTTPException(403, { message: 'forbidden' });
  await db.delete(designTemplates).where(eq(designTemplates.id, row.id));
  // Ministries whose meetings wore it go back to their own look.
  await db
    .update(groups)
    .set({ meetingTemplateId: null })
    .where(eq(groups.meetingTemplateId, row.id));
  await db.update(groups).set({ eventTemplateId: null }).where(eq(groups.eventTemplateId, row.id));
  return c.json({ ok: true });
});
