import { and, eq, inArray } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { INTL_LOCALE, displayName, messages, type DutiesNotice, type Locale } from '@church/shared';
import type { Db } from '../db/client';
import {
  eventRoleAssignees,
  eventRoles,
  memberships,
  users,
  type Group,
  type events,
} from '../db/schema';
import { recordNotification } from './notifications';
import {
  eventMovingId,
  eventPictureId,
  eventRoster,
  rosterLines,
  type Roster,
} from './eventRoster';

type Event = typeof events.$inferSelect;
import { churchDefaultLocale, getAppUrl, getChurch, localeOf } from './church';
import { escapeHtml } from './html';
import { enqueue } from './outbox';

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');

/** Buttons under an event message: open it, and (when it has duties) who serves where. */
function eventKeyboard(
  t: ReturnType<typeof messages>,
  eventId: number,
  appUrl: string | undefined,
  hasDuties: boolean,
) {
  const kb = new InlineKeyboard();
  if (appUrl) kb.webApp(t.bot.eventButton, `${appUrl}/?event=${eventId}`);
  if (hasDuties) {
    if (appUrl) kb.row();
    kb.text(t.bot.rosterButton, `ro:${eventId}`);
  }
  return appUrl || hasDuties ? kb : undefined;
}

/** An event message for the outbox: with the event's picture when it has one and the text fits. */
function eventPayload(
  chatId: number,
  html: string,
  picture: number | null,
  reply_markup: InlineKeyboard | undefined,
) {
  // Photo captions are limited to 1024 characters; longer messages go as text.
  return picture && html.length <= 1024
    ? {
        method: 'sendPhoto' as const,
        payload: {
          chat_id: chatId,
          photo_media_id: picture,
          caption: html,
          parse_mode: 'HTML',
          reply_markup,
        },
      }
    : {
        method: 'sendMessage' as const,
        payload: {
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          reply_markup,
          link_preview_options: { is_disabled: true },
        },
      };
}

const dotOf = (roster: Roster, name: string) =>
  roster.find((r) => r.name === name)?.color.dot ?? '•';

async function whenOf(db: Db, event: Event, locale: Locale) {
  const { timezone } = await getChurch(db);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(event.startsAt));
}

/** What the default reminder adds: a piece of the description, and the person's own duties. */
async function extras(db: Db, event: Event, userId: number | null, locale: Locale) {
  const t = messages(locale);
  const description = event.description ? event.description.trim().slice(0, 280) : '';
  const duties = userId
    ? (
        await db
          .select({ name: eventRoles.name })
          .from(eventRoleAssignees)
          .innerJoin(eventRoles, eq(eventRoles.id, eventRoleAssignees.roleId))
          .where(and(eq(eventRoles.eventId, event.id), eq(eventRoleAssignees.userId, userId)))
      ).map((d) => d.name)
    : [];
  return {
    description,
    duty: duties.length ? t.bot.eventYourDuty(duties.join(', ')) : '',
  };
}

/** The default reminder as plain text (for the sender to read and change). */
export async function defaultReminderText(db: Db, event: Event, locale: Locale): Promise<string> {
  const t = messages(locale);
  const when = await whenOf(db, event, locale);
  const { description } = await extras(db, event, null, locale);
  return [stripTags(t.bot.eventReminder(event.title, when, event.location)), description]
    .filter(Boolean)
    .join('\n\n');
}

/** Active members of a ministry (optionally only these people); `bot` = the bot can write to them. */
async function recipients(db: Db, groupId: number, userIds?: number[] | null) {
  const rows = await db
    .select({
      id: users.id,
      chatId: users.telegramId,
      reachable: users.isReachable,
      locale: users.locale,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.status, 'active'),
        ...(userIds && userIds.length > 0 ? [inArray(users.id, userIds)] : []),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chatId,
    locale: r.locale,
    bot: r.chatId !== null && r.reachable,
  }));
}

/** The one person a test goes to (even when they aren't a member, like a church admin). */
async function testRecipient(db: Db, userId: number) {
  const rows = await db
    .select({
      id: users.id,
      chatId: users.telegramId,
      reachable: users.isReachable,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, userId));
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chatId,
    locale: r.locale,
    bot: r.chatId !== null && r.reachable,
  }));
}

/**
 * Reminds the ministry's members (or only chosen ones). With a custom text it goes as
 * written (plus the sender's name); without, each person gets the default in their own
 * language, with a bit of the description and their own duties. Everyone gets it in the
 * app's notification list; the bot message goes to those it can reach.
 */
export async function sendEventReminder(
  db: Db,
  args: {
    event: Event;
    group: Pick<Group, 'id'>;
    text?: string | null;
    userIds?: number[] | null;
    senderName?: string | null;
    envAppUrl?: string;
    fallbackUrl: string | null;
    /** Stable key part so an automatic reminder can't be queued twice. */
    dedupe?: string;
    /** Add who serves where. */
    roster?: boolean;
    /** With the event's picture (default yes). */
    poster?: boolean;
    /** "It's live now" instead of a reminder. */
    live?: boolean;
    /** With `live`: pin the message until this time, then remove it. */
    liveEndsAt?: string;
    /** A test: only this person gets it, marked as a test and not in the notifications. */
    testTo?: number;
  },
): Promise<{ total: number; bot: number }> {
  const fallback = await churchDefaultLocale(db);
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const list = args.testTo
    ? await testRecipient(db, args.testTo)
    : await recipients(db, args.group.id, args.userIds);
  const stamp = args.dedupe ?? String(Date.now());
  const roster = await eventRoster(db, args.event.id);
  // The moving cover when one is recorded (it plays like a GIF), else the still picture.
  const picture =
    args.poster === false ? null : (eventMovingId(args.event) ?? eventPictureId(args.event));
  let bot = 0;
  for (const r of list) {
    const locale = localeOf({ locale: r.locale }, fallback);
    const t = messages(locale);
    const when = await whenOf(db, args.event, locale);
    const more = await extras(db, args.event, r.id, locale);
    let html: string;
    let title = t.bot.notifReminderTitle(args.event.title);
    let body: string;
    if (args.live) {
      html = t.bot.eventLive(
        escapeHtml(args.event.title),
        args.event.location ? escapeHtml(args.event.location) : null,
      );
      title = t.bot.notifLiveTitle(args.event.title);
      body = [when, args.event.location].filter(Boolean).join('\n');
    } else if (args.text) {
      const [first, ...rest] = escapeHtml(args.text).split('\n');
      html = [`<b>${first}</b>`, ...rest].join('\n');
      title = args.text.split('\n')[0]!;
      body = args.text.split('\n').slice(1).join('\n').trim() || when;
    } else {
      html = t.bot.eventReminder(
        escapeHtml(args.event.title),
        when,
        args.event.location ? escapeHtml(args.event.location) : null,
      );
      if (more.description) html += `\n\n<i>${escapeHtml(more.description)}</i>`;
      if (more.duty) html += `\n\n🛠 ${escapeHtml(more.duty)}`;
      body = [when, args.event.location, more.description, more.duty].filter(Boolean).join('\n');
    }
    if (args.roster && !args.live && roster.length)
      html += `\n\n👥 <b>${t.bot.responsible}</b>\n${rosterLines(roster, locale).join('\n')}`;
    if (args.senderName) html += `\n\n<i>${escapeHtml(t.bot.sentBy(args.senderName))}</i>`;
    if (args.testTo) html = `🧪 <i>${escapeHtml(t.bot.testOnlyYou)}</i>\n\n${html}`;
    if (!args.testTo)
      await recordNotification(db, {
        userId: r.id,
        kind: 'event_reminder',
        title,
        body: args.senderName ? `${body}\n${t.bot.sentBy(args.senderName)}` : body,
        link: { type: 'event', eventId: args.event.id },
      });
    if (!r.bot) continue;
    const reply_markup = eventKeyboard(t, args.event.id, appUrl, roster.length > 0);
    const message = eventPayload(r.chatId!, html, picture, reply_markup);
    await enqueue(db, {
      chatId: r.chatId!,
      method: message.method,
      payload: args.liveEndsAt
        ? {
            ...message.payload,
            _live: { kind: 'event', refId: args.event.id, endsAt: args.liveEndsAt },
          }
        : message.payload,
      dedupeKey: `evremind:${args.event.id}:${r.chatId}:${stamp}`,
    });
    bot++;
  }
  return { total: list.length, bot };
}

/**
 * Tells each newly assigned person which duty(ies) they were given (with what it
 * involves), naming who assigned them, with a button to the event. Returns how many
 * people were queued.
 */
export async function notifyDuties(
  db: Db,
  args: {
    event: Event;
    added: { userId: number; roleName: string; description: string | null }[];
    sender: { id: number; name: string };
    envAppUrl?: string;
    fallbackUrl: string | null;
  },
): Promise<DutiesNotice> {
  const fallback = await churchDefaultLocale(db);
  const appUrl = ((await getAppUrl(db, args.envAppUrl)) ?? args.fallbackUrl)?.replace(/\/+$/, '');
  const byUser = new Map<number, typeof args.added>();
  for (const a of args.added) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);
  if (byUser.size === 0) return { sent: 0, skipped: [] };
  const people = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      chatId: users.telegramId,
      locale: users.locale,
      reach: users.isReachable,
    })
    .from(users)
    .where(inArray(users.id, [...byUser.keys()]));
  const roster = await eventRoster(db, args.event.id);
  const picture = eventPictureId(args.event);
  let queued = 0;
  // People the bot can't write to (never started it, or blocked it) are named, so the sender knows.
  const skipped: string[] = [];
  for (const p of people) {
    const locale = localeOf({ locale: p.locale }, fallback);
    const t = messages(locale);
    const mine = byUser.get(p.id)!;
    // Always kept in the app, even when the bot can't reach them.
    await recordNotification(db, {
      userId: p.id,
      kind: 'event_duty',
      title: t.bot.notifDutyTitle(args.event.title),
      body: [
        mine
          .map((d) => (d.description ? `${d.roleName} — ${d.description}` : d.roleName))
          .join('\n'),
        `${t.bot.sentBy(args.sender.name)}`,
      ].join('\n'),
      link: { type: 'event', eventId: args.event.id },
    });
    if (!p.chatId || !p.reach) {
      skipped.push(displayName(p));
      continue;
    }
    const duties = byUser
      .get(p.id)!
      .map(
        (d) =>
          `${dotOf(roster, d.roleName)} <b>${escapeHtml(d.roleName)}</b>${d.description ? ` — ${escapeHtml(d.description)}` : ''}`,
      )
      .join('\n');
    const when = await whenOf(db, args.event, locale);
    let html = t.bot.eventDuty(escapeHtml(args.event.title), when, duties);
    if (args.event.location) html += `\n📍 ${escapeHtml(args.event.location)}`;
    html += `\n\n<i>${escapeHtml(t.bot.sentBy(args.sender.name))}</i>`;
    const reply_markup = eventKeyboard(t, args.event.id, appUrl, roster.length > 0);
    await enqueue(db, {
      chatId: p.chatId,
      ...eventPayload(p.chatId, html, picture, reply_markup),
      dedupeKey: `evduty:${args.event.id}:${p.chatId}:${Date.now()}`,
    });
    queued++;
  }
  return { sent: queued, skipped };
}
