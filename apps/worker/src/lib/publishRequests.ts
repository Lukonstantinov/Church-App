import { and, eq, inArray } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import {
  announceMeetingSchema,
  displayName,
  messages,
  remindEventSchema,
  type AnnounceMeetingInput,
  type PublishRequestRow,
  type RemindEventInput,
} from '@church/shared';
import type { Db } from '../db/client';
import {
  events,
  meetings,
  publishRequests,
  users,
  type EventRow as Event,
  type Meeting,
  type User,
} from '../db/schema';
import { accessIn } from './access';
import { audit } from './audit';
import { churchDefaultLocale, getAppUrl, localeOf } from './church';
import { eventMovingId, eventPictureId } from './eventRoster';
import { sendEventReminder } from './eventReminder';
import { escapeHtml } from './html';
import { signedMediaUrl } from './media';
import { announceMeeting } from './meetingAnnounce';
import { leaderRecipients } from './membership';
import { recordNotification } from './notifications';
import { enqueue } from './outbox';

export type PublishKind = 'meeting' | 'event';

/**
 * Who may send a meeting announcement or an event reminder to everyone: those who manage
 * meetings / events, and publishers (the "announce" right: posts, announcements, reminders).
 */
export async function mayPublish(
  db: Db,
  user: User,
  groupId: number,
  kind: PublishKind,
): Promise<boolean> {
  const a = await accessIn(db, user, groupId);
  return (
    a.member &&
    (a.perms.has('announce') ||
      a.perms.has(kind === 'meeting' ? 'meetings.manage' : 'events.manage'))
  );
}

/** Designers prepare messages (and test them on themselves); publishers may test too. */
export async function mayPrepare(db: Db, user: User, groupId: number, kind: PublishKind) {
  const a = await accessIn(db, user, groupId);
  return a.perms.has('design') || (await mayPublish(db, user, groupId, kind));
}

interface Links {
  envAppUrl?: string;
  fallbackUrl: string | null;
}

/** Sends a meeting announcement as asked and notes who announced it. */
export async function publishMeeting(
  db: Db,
  args: Links & { meeting: Meeting; input: AnnounceMeetingInput; sender: User },
) {
  const input = announceMeetingSchema.parse(args.input);
  const { meeting, sender } = args;
  if (input.notice !== 'cancelled')
    await db
      .update(meetings)
      .set({
        announcedBy: sender.id,
        announcedAt: new Date().toISOString(),
        ...(input.ask ? { askRsvp: true } : {}),
      })
      .where(eq(meetings.id, meeting.id));
  const result = await announceMeeting(db, {
    meeting,
    notice: input.notice,
    ask: input.ask,
    previousStartsAt: input.previousStartsAt,
    text: input.text,
    userIds: input.userIds,
    posterMediaId: input.posterMediaId,
    senderName: displayName(sender),
    envAppUrl: args.envAppUrl,
    fallbackUrl: args.fallbackUrl,
  });
  await audit(db, {
    actorUserId: sender.id,
    action: 'meeting_announced',
    entity: 'group',
    entityId: meeting.groupId,
    groupId: meeting.groupId,
    data: { meetingId: meeting.id, sent: result.total, chosen: input.userIds?.length ?? null },
  });
  return result;
}

/** Sends an event reminder as asked and notes it. */
export async function publishEvent(
  db: Db,
  args: Links & { event: Event; input: RemindEventInput; sender: User },
) {
  const input = remindEventSchema.parse(args.input);
  const { event, sender } = args;
  const result = await sendEventReminder(db, {
    event,
    group: { id: event.groupId },
    text: input.text,
    userIds: input.userIds,
    roster: input.roster,
    poster: input.poster,
    posterMediaId: input.posterMediaId,
    senderName: displayName(sender),
    envAppUrl: args.envAppUrl,
    fallbackUrl: args.fallbackUrl,
  });
  await audit(db, {
    actorUserId: sender.id,
    action: 'event_reminder_sent',
    entity: 'event',
    entityId: event.id,
    groupId: event.groupId,
    data: { sent: result.total, chosen: input.userIds?.length ?? null },
  });
  return result;
}

/**
 * A designer's prepared message goes to those who may publish it: the poster with the text
 * under it and "Send" / "Decline" buttons. An older request for the same meeting or event
 * is replaced. Returns how many people were asked.
 */
export async function requestPublish(
  db: Db,
  args: Links & {
    kind: PublishKind;
    item: Meeting | Event;
    input: AnnounceMeetingInput | RemindEventInput;
    requester: User;
  },
): Promise<{ id: number; asked: number }> {
  const { kind, item, requester } = args;
  const input =
    kind === 'meeting'
      ? announceMeetingSchema.parse(args.input)
      : remindEventSchema.parse(args.input);
  const posterMediaId =
    kind === 'meeting'
      ? ((input as AnnounceMeetingInput).posterMediaId ?? null)
      : (input as RemindEventInput).poster === false
        ? null
        : ((input as RemindEventInput).posterMediaId ??
          eventMovingId(item as Event) ??
          eventPictureId(item as Event) ??
          null);
  await db
    .update(publishRequests)
    .set({ status: 'withdrawn' })
    .where(
      and(
        eq(publishRequests.kind, kind),
        eq(publishRequests.refId, item.id),
        eq(publishRequests.status, 'pending'),
      ),
    );
  const [row] = await db
    .insert(publishRequests)
    .values({
      groupId: item.groupId,
      kind,
      refId: item.id,
      payload: JSON.stringify(input),
      posterMediaId,
      requestedBy: requester.id,
    })
    .returning();
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const link = kind === 'meeting' ? `?meeting=${item.id}` : `?event=${item.id}`;
  const approvers = (
    await leaderRecipients(db, item.groupId, [
      'announce',
      kind === 'meeting' ? 'meetings.manage' : 'events.manage',
    ])
  ).filter((r) => r.userId !== requester.id);
  const preview = (input.text ?? '').slice(0, 700);
  for (const r of approvers) {
    const t = messages(r.locale).bot;
    const head = t.publishAsk(escapeHtml(displayName(requester)), escapeHtml(item.title));
    const html = `${head}${preview ? `\n\n${escapeHtml(preview)}` : ''}`;
    const kb = new InlineKeyboard()
      .text(t.publishSend, `pq:s:${row!.id}`)
      .text(t.publishDecline, `pq:d:${row!.id}`);
    if (appUrl) kb.row().webApp(t.publishOpen, `${appUrl}/${link}`);
    const asPhoto = posterMediaId !== null && html.length <= 1024;
    await recordNotification(db, {
      userId: r.userId,
      kind: 'publish_request',
      title: t.publishAskTitle(item.title),
      body: `${displayName(requester)}\n${preview}`,
      link:
        kind === 'meeting'
          ? { type: 'task', meetingId: item.id }
          : { type: 'event', eventId: item.id },
    });
    await enqueue(db, {
      chatId: r.chatId,
      method: asPhoto ? 'sendPhoto' : 'sendMessage',
      payload: asPhoto
        ? {
            chat_id: r.chatId,
            photo_media_id: posterMediaId,
            caption: html,
            parse_mode: 'HTML',
            reply_markup: kb,
          }
        : {
            chat_id: r.chatId,
            text: html,
            parse_mode: 'HTML',
            reply_markup: kb,
            link_preview_options: { is_disabled: true },
          },
      dedupeKey: `pubreq:${row!.id}:${r.chatId}`,
    });
  }
  await audit(db, {
    actorUserId: requester.id,
    action: 'publish_requested',
    entity: kind === 'meeting' ? 'group' : 'event',
    entityId: kind === 'meeting' ? item.groupId : item.id,
    groupId: item.groupId,
    data: { kind, refId: item.id, asked: approvers.length },
  });
  return { id: row!.id, asked: approvers.length };
}

export type DecideResult =
  | { kind: 'sent'; total: number; bot: number }
  | { kind: 'declined' }
  | { kind: 'not_allowed' }
  | { kind: 'handled' }
  | { kind: 'gone' };

/**
 * An approver sends the prepared message (exactly as prepared, signed by the approver) or
 * declines it. Claimed first, so two approvers tapping at once can't send it twice. The
 * designer hears what happened.
 */
export async function decidePublish(
  db: Db,
  args: Links & { id: number; approver: User; approve: boolean },
): Promise<DecideResult> {
  const req = await db.query.publishRequests.findFirst({
    where: eq(publishRequests.id, args.id),
  });
  if (!req) return { kind: 'gone' };
  if (!(await mayPublish(db, args.approver, req.groupId, req.kind))) return { kind: 'not_allowed' };
  if (req.status !== 'pending') return { kind: 'handled' };
  const item =
    req.kind === 'meeting'
      ? await db.query.meetings.findFirst({ where: eq(meetings.id, req.refId) })
      : await db.query.events.findFirst({ where: eq(events.id, req.refId) });
  const claimed = await db
    .update(publishRequests)
    .set({
      status: args.approve && item ? 'sent' : 'declined',
      decidedBy: args.approver.id,
      decidedAt: new Date().toISOString(),
    })
    .where(and(eq(publishRequests.id, req.id), eq(publishRequests.status, 'pending')))
    .returning({ id: publishRequests.id });
  if (claimed.length === 0) return { kind: 'handled' };
  if (!item) return { kind: 'gone' };
  let result: DecideResult = { kind: 'declined' };
  if (args.approve) {
    const input = JSON.parse(req.payload) as AnnounceMeetingInput & RemindEventInput;
    const sent =
      req.kind === 'meeting'
        ? await publishMeeting(db, {
            ...args,
            meeting: item as Meeting,
            input,
            sender: args.approver,
          })
        : await publishEvent(db, { ...args, event: item as Event, input, sender: args.approver });
    result = { kind: 'sent', ...sent };
  }
  await tellRequester(db, req.requestedBy, args.approver, item.title, args.approve);
  return result;
}

/** The designer hears that their message was sent (or declined) and by whom. */
async function tellRequester(
  db: Db,
  requesterId: number,
  approver: User,
  title: string,
  sent: boolean,
) {
  const who = await db.query.users.findFirst({ where: eq(users.id, requesterId) });
  if (!who || who.id === approver.id) return;
  const t = messages(localeOf(who, await churchDefaultLocale(db))).bot;
  const line = sent
    ? t.publishDone(displayName(approver), title)
    : t.publishDeclined(displayName(approver), title);
  await recordNotification(db, {
    userId: who.id,
    kind: 'publish_request',
    title: line,
    body: '',
  });
  if (who.telegramId && who.isReachable)
    await enqueue(db, {
      chatId: who.telegramId,
      method: 'sendMessage',
      payload: { chat_id: who.telegramId, text: escapeHtml(line), parse_mode: 'HTML' },
      dedupeKey: `pubdone:${requesterId}:${title}:${Date.now()}`,
    });
}

/** The pending request of each meeting / event, for their screens. */
export async function pendingRequests(
  db: Db,
  kind: PublishKind,
  refIds: number[],
  secret: string,
  viewerId: number,
): Promise<Map<number, PublishRequestRow>> {
  const out = new Map<number, PublishRequestRow>();
  if (refIds.length === 0) return out;
  const rows = await db
    .select({ req: publishRequests, first: users.firstName, last: users.lastName })
    .from(publishRequests)
    .innerJoin(users, eq(users.id, publishRequests.requestedBy))
    .where(
      and(
        eq(publishRequests.kind, kind),
        inArray(publishRequests.refId, refIds),
        eq(publishRequests.status, 'pending'),
      ),
    );
  for (const { req, first, last } of rows) {
    const input = JSON.parse(req.payload) as { text?: string };
    out.set(req.refId, {
      id: req.id,
      requestedBy: displayName({ firstName: first, lastName: last }),
      mine: req.requestedBy === viewerId,
      createdAt: req.createdAt,
      text: input.text ?? null,
      posterUrl: req.posterMediaId ? await signedMediaUrl(secret, req.posterMediaId) : null,
    });
  }
  return out;
}
