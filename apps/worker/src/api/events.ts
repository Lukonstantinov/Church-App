import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq, isNull } from 'drizzle-orm';
import {
  addPhotoSchema,
  createEventSchema,
  eventExpenseSchema,
  eventPaymentSchema,
  localDate,
  remindEventSchema,
  rsvpSchema,
  setRolesSchema,
  updateEventSchema,
  type PostDesign,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import {
  designTemplates,
  eventPhotos,
  events,
  groups,
  memberships,
  transactions,
} from '../db/schema';
import { assertCan, assertCanViewGroup } from '../lib/access';
import { audit } from '../lib/audit';
import { getChurch } from '../lib/church';
import {
  eventAccess,
  eventDetail,
  eventTimes,
  listEvents,
  listPinned,
  loadEventOr404,
  setRoles,
  setRsvp,
} from '../lib/events';
import { defaultReminderText, sendEventReminder } from '../lib/eventReminder';
import { assertGroupMedia } from '../lib/media';
import { drainOutbox } from '../lib/outbox';
import { appUrlFor, botApi } from '../lib/telegram';
import { displayName } from '@church/shared';
import { churchDefaultLocale, localeOf } from '../lib/church';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** A cover's own photo must be the ministry's; a template must exist. */
async function assertDesign(
  db: AuthVariables['db'],
  groupId: number,
  design: PostDesign | null | undefined,
  templateId: number | null | undefined,
) {
  const photo = design?.custom?.backdrop?.mediaId;
  if (photo) await assertGroupMedia(db, groupId, photo);
  if (templateId) {
    const tpl = await db.query.designTemplates.findFirst({
      columns: { id: true },
      where: eq(designTemplates.id, templateId),
    });
    if (!tpl) throw new HTTPException(400, { message: 'invalid_template' });
  }
}

/** /api/groups/:id/events */
export const groupEventRoutes = new Hono<App>();

groupEventRoutes.get('/:id/events', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCanViewGroup(db, user, idParam(c));
  const scope = c.req.query('scope') === 'past' ? 'past' : 'upcoming';
  return c.json(await listEvents(db, c.env.WEBHOOK_SECRET, [group.id], user.id, scope));
});

groupEventRoutes.post('/:id/events', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'events.manage');
  const input = await parseBody(c, createEventSchema);
  const { timezone } = await getChurch(db);
  const times = eventTimes(input, timezone);
  if (input.coverMediaId) await assertGroupMedia(db, group.id, input.coverMediaId);
  await assertDesign(db, group.id, input.design, input.templateId);
  const [row] = await db
    .insert(events)
    .values({
      groupId: group.id,
      title: input.title,
      description: input.description,
      ...times,
      location: input.location,
      coverMediaId: input.coverMediaId ?? null,
      design: input.design ? JSON.stringify(input.design) : null,
      templateId: input.templateId ?? null,
      countdown: input.countdown ?? false,
      hasGallery: input.features.gallery,
      hasRsvp: input.features.rsvp,
      hasDuties: input.features.duties || input.roles.length > 0,
      hasCost: input.features.cost,
      priceCents: input.features.cost ? (input.priceCents ?? null) : null,
      chatUrl: input.chatUrl,
      createdBy: user.id,
    })
    .returning();
  if (input.roles.length) await setRoles(db, row!, input.roles);
  await audit(db, {
    actorUserId: user.id,
    action: 'event_created',
    entity: 'event',
    entityId: row!.id,
    groupId: group.id,
  });
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, row!, user), 201);
});

/** /api/events/:id */
export const eventRoutes = new Hono<App>();

/** GET /api/events/pinned — pinned upcoming events of the whole church (main page). */
eventRoutes.get('/pinned', async (c) => {
  const user = c.get('user');
  return c.json(await listPinned(c.get('db'), c.env.WEBHOOK_SECRET, user.id));
});

eventRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const event = await loadEventOr404(db, idParam(c));
  await eventAccess(db, user, event);
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, event, user));
});

async function managed(c: { get: (k: 'db' | 'user') => unknown }, id: number) {
  const db = c.get('db') as AuthVariables['db'];
  const user = c.get('user') as AuthVariables['user'];
  const event = await loadEventOr404(db, id);
  const { canManage } = await eventAccess(db, user, event);
  if (!canManage) throw new HTTPException(403, { message: 'forbidden' });
  return { db, user, event };
}

/** The default reminder text, in the sender's language, to read and change before sending. */
eventRoutes.get('/:id/reminder-text', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  const locale = localeOf(user, await churchDefaultLocale(db));
  return c.json({ text: await defaultReminderText(db, event, locale) });
});

/**
 * Remind the ministry (or only chosen people) about this event. Leaders with the right to
 * manage events (church admins and developers included). The text goes as edited, with
 * who sent it.
 */
eventRoutes.post('/:id/remind', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  if (event.status === 'cancelled') throw new HTTPException(409, { message: 'cancelled' });
  const input = await parseBody(c, remindEventSchema);
  const sent = await sendEventReminder(db, {
    event,
    group: { id: event.groupId },
    text: input.text,
    userIds: input.userIds,
    senderName: displayName(user),
    envAppUrl: c.env.APP_URL,
    fallbackUrl: appUrlFor(c.env, c.req.url),
  });
  if (sent > 0)
    c.executionCtx.waitUntil(
      drainOutbox(db, botApi(c.env), { limit: 100 }).catch((err) =>
        console.error('reminder drain', err),
      ),
    );
  await audit(db, {
    actorUserId: user.id,
    action: 'event_reminder_sent',
    entity: 'event',
    entityId: event.id,
    groupId: event.groupId,
    data: { sent, chosen: input.userIds?.length ?? null },
  });
  return c.json({ sent });
});

eventRoutes.patch('/:id', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  const input = await parseBody(c, updateEventSchema);
  const patch: Partial<typeof events.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.location !== undefined) patch.location = input.location;
  if (input.chatUrl !== undefined) patch.chatUrl = input.chatUrl;
  if (input.status !== undefined) patch.status = input.status;
  if (input.pinned !== undefined) patch.pinnedAt = input.pinned ? new Date().toISOString() : null;
  if (input.priceCents !== undefined) patch.priceCents = input.priceCents;
  if (input.design !== undefined || input.templateId !== undefined) {
    await assertDesign(db, event.groupId, input.design, input.templateId);
    if (input.design !== undefined)
      patch.design = input.design ? JSON.stringify(input.design) : null;
    if (input.templateId !== undefined) patch.templateId = input.templateId;
  }
  if (input.countdown !== undefined) patch.countdown = input.countdown;
  if (input.coverMediaId !== undefined) {
    if (input.coverMediaId) await assertGroupMedia(db, event.groupId, input.coverMediaId);
    patch.coverMediaId = input.coverMediaId;
  }
  if (input.date !== undefined || input.startTime !== undefined) {
    if (!input.date || !input.startTime) throw new HTTPException(400, { message: 'date_and_time' });
    const { timezone } = await getChurch(db);
    Object.assign(
      patch,
      eventTimes(
        {
          date: input.date,
          startTime: input.startTime,
          endDate: input.endDate,
          endTime: input.endTime,
        },
        timezone,
      ),
    );
  }
  const f = input.features;
  if (f?.gallery !== undefined) patch.hasGallery = f.gallery;
  if (f?.rsvp !== undefined) patch.hasRsvp = f.rsvp;
  if (f?.duties !== undefined) patch.hasDuties = f.duties;
  if (f?.cost !== undefined) patch.hasCost = f.cost;

  const [row] = Object.keys(patch).length
    ? await db.update(events).set(patch).where(eq(events.id, event.id)).returning()
    : [event];
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, row!, user));
});

eventRoutes.put('/:id/roles', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  const { roles } = await parseBody(c, setRolesSchema);
  await setRoles(db, event, roles);
  const row =
    roles.length && !event.hasDuties
      ? (
          await db
            .update(events)
            .set({ hasDuties: true })
            .where(eq(events.id, event.id))
            .returning()
        )[0]!
      : event;
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, row, user));
});

eventRoutes.put('/:id/rsvp', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const event = await loadEventOr404(db, idParam(c));
  const { canManage } = await eventAccess(db, user, event);
  const input = await parseBody(c, rsvpSchema);
  if (!event.hasRsvp) throw new HTTPException(409, { message: 'rsvp_off' });
  if (event.status === 'cancelled') throw new HTTPException(409, { message: 'cancelled' });
  const target = input.userId ?? user.id;
  if (target !== user.id && !canManage) throw new HTTPException(403, { message: 'forbidden' });
  await setRsvp(db, event, target, input.status);
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, event, user));
});

eventRoutes.post('/:id/photos', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  const { mediaIds } = await parseBody(c, addPhotoSchema);
  for (const id of mediaIds) await assertGroupMedia(db, event.groupId, id);
  await db.insert(eventPhotos).values(mediaIds.map((mediaId) => ({ eventId: event.id, mediaId })));
  const row = event.hasGallery
    ? event
    : (
        await db.update(events).set({ hasGallery: true }).where(eq(events.id, event.id)).returning()
      )[0]!;
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, row, user), 201);
});

eventRoutes.delete('/:id/photos/:photoId', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  await db
    .delete(eventPhotos)
    .where(and(eq(eventPhotos.id, idParam(c, 'photoId')), eq(eventPhotos.eventId, event.id)));
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, event, user));
});

eventRoutes.post('/:id/payments', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  const input = await parseBody(c, eventPaymentSchema);
  if (!event.hasCost) throw new HTTPException(409, { message: 'cost_off' });
  const amount = input.amountCents ?? event.priceCents;
  if (!amount) throw new HTTPException(400, { message: 'no_price' });
  const member = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(memberships.groupId, event.groupId), eq(memberships.userId, input.userId)),
  });
  if (!member) throw new HTTPException(400, { message: 'not_a_member' });
  const { timezone } = await getChurch(db);
  await db.insert(transactions).values({
    groupId: event.groupId,
    kind: 'event_payment',
    amountCents: amount,
    occurredOn: localDate(Date.now(), timezone),
    memberUserId: input.userId,
    eventId: event.id,
    note: event.title,
    createdBy: user.id,
  });
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, event, user), 201);
});

eventRoutes.post('/:id/expenses', async (c) => {
  const { db, user, event } = await managed(c, idParam(c));
  const input = await parseBody(c, eventExpenseSchema);
  if (!event.hasCost) throw new HTTPException(409, { message: 'cost_off' });
  if (input.receiptMediaId) await assertGroupMedia(db, event.groupId, input.receiptMediaId);
  const { timezone } = await getChurch(db);
  await db.insert(transactions).values({
    groupId: event.groupId,
    kind: 'event_expense',
    amountCents: input.amountCents,
    occurredOn: localDate(Date.now(), timezone),
    eventId: event.id,
    note: input.note ?? event.title,
    receiptMediaId: input.receiptMediaId ?? null,
    createdBy: user.id,
  });
  return c.json(await eventDetail(db, c.env.WEBHOOK_SECRET, event, user), 201);
});

/** GET /api/me/events — upcoming events in the user's groups. */
export const myEventRoutes = new Hono<App>();

myEventRoutes.get('/', async (c) => {
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
  return c.json(
    await listEvents(
      db,
      c.env.WEBHOOK_SECRET,
      rows.map((r) => r.groupId),
      user.id,
      'upcoming',
      10,
    ),
  );
});
