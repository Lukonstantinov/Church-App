import { decidePublish } from '../lib/publishRequests';
import { eq } from 'drizzle-orm';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import {
  displayName,
  localDate,
  messages,
  type Locale,
  type Messages,
  type TestAsInput,
} from '@church/shared';
import { birthdayMessage, birthdayRows, comingBirthdays } from '../lib/birthdays';
import { adminTelegramIds, isDeveloper, type Env } from '../env';
import { getDb, type Db } from '../db/client';
import { events, meetings, memberships, type User } from '../db/schema';
import { eventPictureId, eventRoster, rosterMessage } from '../lib/eventRoster';
import { eventAccess } from '../lib/events';
import { acceptPrivacy, upsertTelegramUser } from '../lib/users';
import { churchDefaultLocale, getChurch, localeOf } from '../lib/church';
import { botApi, getBotInfo } from '../lib/telegram';
import { DEEP_LINK } from '../lib/codes';
import { mediaFile } from '../lib/media';
import { answerMeetingRsvp } from '../lib/meetingAnnounce';
import { drainOutbox } from '../lib/outbox';
import {
  announceJoinDecision,
  decideJoin,
  notifyJoinRequest,
  requestJoin,
} from '../lib/membership';
import { can, groupsWithPermission } from '../lib/access';
import { claimProfile } from '../lib/claim';
import {
  myServicesText,
  nearestEvents,
  rosterText,
  scheduleText,
  type SchedulePeriod,
} from '../lib/botDigest';
import { completeChatLink, handleJoinRequest, retryPendingLink } from '../lib/chats';
import {
  completeEventChatLink,
  handleEventJoinRequest,
  retryPendingEventLink,
} from '../lib/eventChats';
import { answerHelper } from '../lib/meetingHelpers';
import { answerMeetingRole } from '../lib/meetingNotify';
import { escapeHtml } from '../lib/html';
import { startTesting, stopTesting, testOptions } from '../lib/testing';

export interface BotDeps {
  env: Env;
  /** Public HTTPS origin of the Mini App, e.g. https://church-app.example.workers.dev */
  appUrl: string;
}

type Ctx = Context & { dbUser: User; t: Messages };

/** Links to people's Telegram must not unfold into a big profile preview. */
const NO_PREVIEW = { is_disabled: true };

export async function createBot({ env, appUrl }: BotDeps): Promise<Bot<Ctx>> {
  const bot = new Bot<Ctx>(env.BOT_TOKEN, { botInfo: await getBotInfo(env) });
  const db = getDb(env.DB);
  const admins = adminTelegramIds(env);
  const churchLocale = await churchDefaultLocale(db);
  const openAppKeyboard = (t: Messages) => new InlineKeyboard().webApp(t.bot.openApp, appUrl);

  // Group chats: linking a ministry chat and gatekeeping who joins it.
  const groupChat = bot.chatType(['group', 'supergroup']);

  groupChat.command('start', async (ctx) => {
    const payload = ctx.match.trim();
    if (payload.startsWith(DEEP_LINK.eventChat) && ctx.from && !ctx.from.is_bot) {
      const by = await upsertTelegramUser(db, ctx.from, admins);
      const t = messages(localeOf(by, churchLocale));
      const { result, event } = await completeEventChatLink(ctx.api, db, {
        code: payload.slice(DEEP_LINK.eventChat.length),
        chatId: ctx.chat.id,
        chatTitle: ctx.chat.title,
        by,
      });
      await ctx.reply(
        result === 'linked'
          ? t.bot.eventChatLinked(event!.title)
          : result === 'need_admin'
            ? t.bot.chatNeedAdmin
            : result === 'forbidden'
              ? t.bot.chatLinkForbidden
              : t.bot.chatLinkInvalid,
      );
      return;
    }
    if (!payload.startsWith(DEEP_LINK.chat) || !ctx.from || ctx.from.is_bot) return;
    const by = await upsertTelegramUser(db, ctx.from, admins);
    const t = messages(localeOf(by, churchLocale));
    const { result, group } = await completeChatLink(ctx.api, db, {
      code: payload.slice(DEEP_LINK.chat.length),
      chatId: ctx.chat.id,
      chatTitle: ctx.chat.title,
      by,
    });
    const text =
      result === 'linked'
        ? t.bot.chatLinked(group!.name)
        : result === 'need_admin'
          ? t.bot.chatNeedAdmin
          : result === 'forbidden'
            ? t.bot.chatLinkForbidden
            : t.bot.chatLinkInvalid;
    await ctx.reply(text);
  });

  // Promoted to admin in a chat waiting to be linked: finish linking.
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;
    if (ctx.myChatMember.new_chat_member.status !== 'administrator') return;
    const group = await retryPendingLink(ctx.api, db, chat.id, chat.title);
    if (group)
      await ctx.api.sendMessage(chat.id, messages(churchLocale).bot.chatLinked(group.name));
    const event = group ? null : await retryPendingEventLink(ctx.api, db, chat.id, chat.title);
    if (event)
      await ctx.api.sendMessage(chat.id, messages(churchLocale).bot.eventChatLinked(event.title));
  });

  bot.on('chat_join_request', async (ctx) => {
    const req = ctx.chatJoinRequest;
    const args = { chatId: req.chat.id, telegramId: req.from.id, userChatId: req.user_chat_id };
    // A ministry's chat, else an event's.
    if ((await handleJoinRequest(ctx.api, db, args)) === 'unknown_chat')
      await handleEventJoinRequest(ctx.api, db, args);
  });

  // Private chats with the bot.
  const pm = bot.chatType('private');

  // Load (and create on first contact) the user behind every private update.
  pm.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    ctx.dbUser = await upsertTelegramUser(db, ctx.from, admins);
    ctx.t = messages(localeOf(ctx.dbUser, churchLocale));
    await next();
  });

  /** Runs a deep-link payload (join/claim) for a user who has accepted the privacy notice. */
  async function handlePayload(ctx: Ctx, payload: string) {
    if (payload.startsWith(DEEP_LINK.join)) {
      await handleJoin(ctx, db, payload.slice(DEEP_LINK.join.length));
    } else if (payload.startsWith(DEEP_LINK.claim)) {
      await handleClaim(ctx, db, payload.slice(DEEP_LINK.claim.length), openAppKeyboard(ctx.t));
    } else {
      await ctx.reply(ctx.t.bot.welcome(ctx.dbUser.firstName), {
        reply_markup: openAppKeyboard(ctx.t),
      });
    }
  }

  async function handleJoin(ctx: Ctx, database: Db, code: string) {
    const result = await requestJoin(database, ctx.dbUser, code);
    switch (result.kind) {
      case 'invalid':
        return void (await ctx.reply(ctx.t.bot.inviteNotFound));
      case 'already_member':
        return void (await ctx.reply(ctx.t.bot.joinAlreadyMember(result.group.name), {
          reply_markup: openAppKeyboard(ctx.t),
        }));
      case 'already_pending':
        return void (await ctx.reply(ctx.t.bot.joinAlreadyPending(result.group.name)));
      case 'requested':
        await ctx.reply(ctx.t.bot.joinRequested(result.group.name));
        await notifyJoinRequest(ctx.api, database, result.membership.id);
    }
  }

  pm.command('start', async (ctx) => {
    const payload = ctx.match.trim();
    const needsConsent = payload !== '' && ctx.dbUser.privacyAcceptedAt === null;
    if (needsConsent) {
      await ctx.reply(ctx.t.bot.privacyNotice, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(
          ctx.t.bot.privacyAccept,
          `pv:${payload}`.slice(0, 64),
        ),
      });
      return;
    }
    await handlePayload(ctx, payload);
  });

  pm.callbackQuery(/^pv:(.*)$/, async (ctx) => {
    await acceptPrivacy(db, ctx.dbUser.id);
    ctx.dbUser.privacyAcceptedAt = new Date().toISOString();
    await ctx.answerCallbackQuery({ text: ctx.t.bot.privacyAccepted });
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await handlePayload(ctx, ctx.match[1] ?? '');
  });

  pm.callbackQuery(/^jr:([ar]):(\d+)$/, async (ctx) => {
    const approve = ctx.match[1] === 'a';
    const membershipId = Number(ctx.match[2]);
    const membership = await db.query.memberships.findFirst({
      where: eq(memberships.id, membershipId),
    });
    if (!membership || !(await can(db, ctx.dbUser, membership.groupId, 'people.manage'))) {
      return void (await ctx.answerCallbackQuery({ text: ctx.t.bot.notAllowed, show_alert: true }));
    }
    const result = await decideJoin(db, ctx.dbUser, membershipId, approve);
    if (result.kind !== 'ok') {
      await ctx.answerCallbackQuery({ text: ctx.t.bot.alreadyHandled });
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      return;
    }
    await ctx.answerCallbackQuery();
    await announceJoinDecision(ctx.api, db, result, ctx.dbUser, appUrl);
  });

  // "Agree" / "Can't" under a meeting assignment. The way into the meeting stays.
  pm.callbackQuery(/^ma:([yn]):(\d+):([ls])$/, async (ctx) => {
    const agree = ctx.match[1] === 'y';
    const meetingId = Number(ctx.match[2]);
    const result = await answerMeetingRole(db, ctx.api, {
      meetingId,
      role: ctx.match[3] === 'l' ? 'leader' : 'snack',
      agree,
      user: ctx.dbUser,
    });
    if (result === 'not_yours') {
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      await ctx.answerCallbackQuery({ text: ctx.t.bot.meetingNotYours, show_alert: true });
      return;
    }
    const meetingUrl = `${appUrl.replace(/\/+$/, '')}/?meeting=${meetingId}`;
    const openMeeting = new InlineKeyboard().webApp(ctx.t.bot.meetingButton, meetingUrl);
    // Agreed: keep "Open meeting" under the message. Can't: the job is gone, so no buttons.
    await ctx
      .editMessageReplyMarkup(agree ? { reply_markup: openMeeting } : undefined)
      .catch(() => undefined);
    await ctx.answerCallbackQuery();
    await ctx.reply(agree ? ctx.t.bot.meetingAgreed : ctx.t.bot.meetingDeclined, {
      reply_markup: agree ? openMeeting : openAppKeyboard(ctx.t),
    });
  });

  // "Agree" / "Can't" under a helper's request (music, welcome…).
  pm.callbackQuery(/^mh:([yn]):(\d+)$/, async (ctx) => {
    const agree = ctx.match[1] === 'y';
    const result = await answerHelper(db, ctx.api, {
      helperId: Number(ctx.match[2]),
      agree,
      user: ctx.dbUser,
    });
    if (result === 'not_yours') {
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      await ctx.answerCallbackQuery({ text: ctx.t.bot.meetingNotYours, show_alert: true });
      return;
    }
    const meetingUrl = `${appUrl.replace(/\/+$/, '')}/?meeting=${result.meetingId}`;
    const openMeeting = new InlineKeyboard().webApp(ctx.t.bot.meetingButton, meetingUrl);
    await ctx.editMessageReplyMarkup({ reply_markup: openMeeting }).catch(() => undefined);
    await ctx.answerCallbackQuery();
    await ctx.reply(agree ? ctx.t.bot.meetingAgreed : ctx.t.bot.meetingDeclined, {
      reply_markup: openMeeting,
    });
  });

  pm.command('app', async (ctx) => {
    await ctx.reply(ctx.t.bot.openApp, { reply_markup: openAppKeyboard(ctx.t) });
  });

  // Personal digests: my services, the nearest events, and the schedule for a period.
  pm.command('services', async (ctx) => {
    await ctx.reply(await myServicesText(db, ctx.dbUser, localeOf(ctx.dbUser, churchLocale)), {
      parse_mode: 'HTML',
      reply_markup: openAppKeyboard(ctx.t),
    });
  });

  // One message per event: its poster (cover photo or designed cover) with the details as
  // the caption; without a picture, or when it can't be sent, the details as text.
  pm.command('events', async (ctx) => {
    const { empty, cards } = await nearestEvents(
      db,
      ctx.dbUser,
      localeOf(ctx.dbUser, churchLocale),
    );
    if (empty) {
      await ctx.reply(empty, { parse_mode: 'HTML', reply_markup: openAppKeyboard(ctx.t) });
      return;
    }
    const base = appUrl.replace(/\/+$/, '');
    await ctx.reply(ctx.t.bot.eventsTitle, { parse_mode: 'HTML' });
    for (const card of cards) {
      const reply_markup = new InlineKeyboard().webApp(
        ctx.t.bot.eventButton,
        `${base}/?event=${card.eventId}`,
      );
      // The bot uploads the picture itself (Telegram can't take some formats by link).
      const file = card.pictureId ? await mediaFile(db, card.pictureId) : null;
      if (file) {
        const fits = card.text.length <= 1024;
        const sent = await ctx
          .replyWithPhoto(file, {
            caption: fits ? card.text : card.text.split('\n\n')[0],
            parse_mode: 'HTML',
            ...(fits ? { reply_markup } : {}),
          })
          .then(() => true)
          .catch(() => false);
        if (sent && fits) continue;
      }
      await ctx.reply(card.text, {
        parse_mode: 'HTML',
        reply_markup,
        link_preview_options: NO_PREVIEW,
      });
    }
  });

  const scheduleKeyboard = (t: Messages, current: SchedulePeriod) =>
    new InlineKeyboard()
      .text(`${current === 'w' ? '• ' : ''}${t.bot.periodWeek}`, 'sc:w')
      .text(`${current === 'm' ? '• ' : ''}${t.bot.periodMonth}`, 'sc:m')
      .text(`${current === 'q' ? '• ' : ''}${t.bot.periodQuarter}`, 'sc:q')
      .row()
      .webApp(t.bot.openApp, appUrl);

  pm.command('schedule', async (ctx) => {
    await ctx.reply(await scheduleText(db, ctx.dbUser, localeOf(ctx.dbUser, churchLocale), 'w'), {
      parse_mode: 'HTML',
      link_preview_options: NO_PREVIEW,
      reply_markup: scheduleKeyboard(ctx.t, 'w'),
    });
  });

  // "Will you come?" under a meeting message: the answer is saved and the sender hears it.
  pm.callbackQuery(/^mr:([yn]):(\d+)$/, async (ctx) => {
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.id, Number(ctx.match[2])),
    });
    if (!meeting || meeting.status === 'cancelled') {
      await ctx.answerCallbackQuery({ text: ctx.t.bot.meetingCancelled });
      return;
    }
    const going = ctx.match[1] === 'y';
    const ok = await answerMeetingRsvp(db, {
      meeting,
      user: ctx.dbUser,
      status: going ? 'going' : 'not_going',
      envAppUrl: env.APP_URL,
      fallbackUrl: appUrl,
    });
    await ctx.answerCallbackQuery({
      text: ok ? (going ? ctx.t.bot.rsvpThanksYes : ctx.t.bot.rsvpThanksNo) : undefined,
      show_alert: false,
    });
    if (ok)
      await drainOutbox(db, botApi(env), { limit: 5 }).catch((err) =>
        console.error('rsvp drain', err),
      );
  });

  // "Send to all" / "Decline" under a designer's prepared announcement or reminder.
  pm.callbackQuery(/^pq:([sd]):(\d+)$/, async (ctx) => {
    const send = ctx.match[1] === 's';
    const result = await decidePublish(db, {
      id: Number(ctx.match[2]),
      approver: ctx.dbUser,
      approve: send,
      envAppUrl: env.APP_URL,
      fallbackUrl: appUrl,
    });
    if (result.kind === 'not_allowed')
      return void (await ctx.answerCallbackQuery({ text: ctx.t.bot.notAllowed, show_alert: true }));
    // Decided (here or by someone else): the buttons go, the way into the app stays.
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.answerCallbackQuery({
      text:
        result.kind === 'sent'
          ? ctx.t.bot.publishSentCount(result.total)
          : result.kind === 'declined'
            ? ctx.t.publish.declined
            : ctx.t.bot.alreadyHandled,
    });
    await drainOutbox(db, botApi(env), { limit: 100 }).catch((err) =>
      console.error('publish drain', err),
    );
  });

  // "Who serves where" under an event message, and as a command for the nearest events.
  pm.callbackQuery(/^ro:(\d+)$/, async (ctx) => {
    const locale = localeOf(ctx.dbUser, churchLocale);
    const event = await db.query.events.findFirst({
      where: eq(events.id, Number(ctx.match[1])),
    });
    const visible =
      event &&
      (await eventAccess(db, ctx.dbUser, event).then(
        () => true,
        () => false,
      ));
    if (!event || !visible) {
      await ctx.answerCallbackQuery({ text: ctx.t.bot.rosterEmpty });
      return;
    }
    await ctx.answerCallbackQuery();
    const text = rosterMessage(event, await eventRoster(db, event.id), locale);
    const reply_markup = new InlineKeyboard().webApp(
      ctx.t.bot.eventButton,
      `${appUrl.replace(/\/+$/, '')}/?event=${event.id}`,
    );
    // With the event's poster when it has one (and the list fits a caption).
    const pictureId = eventPictureId(event);
    const file = pictureId && text.length <= 1024 ? await mediaFile(db, pictureId) : null;
    if (file) {
      const sent = await ctx
        .replyWithPhoto(file, { caption: text, parse_mode: 'HTML', reply_markup })
        .then(() => true)
        .catch(() => false);
      if (sent) return;
    }
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup, link_preview_options: NO_PREVIEW });
  });

  pm.command('roster', async (ctx) => {
    await ctx.reply(await rosterText(db, ctx.dbUser, localeOf(ctx.dbUser, churchLocale)), {
      parse_mode: 'HTML',
      reply_markup: openAppKeyboard(ctx.t),
      link_preview_options: NO_PREVIEW,
    });
  });

  // Birthdays of the coming week (/birthdays) or month (/birthdays month), for church admins
  // (everyone) and those who manage people in a ministry (their ministries' people).
  const birthdaysFor = async (user: User, days: number, locale: Locale) => {
    const t = messages(locale);
    const groupIds = user.isAdmin
      ? undefined
      : await groupsWithPermission(db, user.id, 'people.manage');
    if (groupIds && groupIds.length === 0) return null;
    const today = localDate(new Date(), (await getChurch(db)).timezone);
    const list = comingBirthdays(await birthdayRows(db, groupIds), today, days);
    return birthdayMessage(
      locale,
      days > 7 ? t.birthdays.monthTitle : t.birthdays.weekTitle(days),
      list,
    );
  };
  const birthdayKb = (t: Messages) =>
    new InlineKeyboard().text(t.birthdays.week, 'bd:7').text(t.birthdays.month, 'bd:31');
  pm.command('birthdays', async (ctx) => {
    const days = /month|мес|mėn/i.test(String(ctx.match ?? '')) ? 31 : 7;
    const text = await birthdaysFor(ctx.dbUser, days, localeOf(ctx.dbUser, churchLocale));
    if (!text) return void (await ctx.reply(ctx.t.birthdays.notAllowed));
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: birthdayKb(ctx.t) });
  });
  pm.callbackQuery(/^bd:(7|31)$/, async (ctx) => {
    const text = await birthdaysFor(
      ctx.dbUser,
      Number(ctx.match[1]),
      localeOf(ctx.dbUser, churchLocale),
    );
    await ctx.answerCallbackQuery();
    if (!text) return;
    await ctx
      .editMessageText(text, { parse_mode: 'HTML', reply_markup: birthdayKb(ctx.t) })
      .catch(() => undefined);
  });

  pm.callbackQuery(/^sc:([wmq])$/, async (ctx) => {
    const period = ctx.match[1] as SchedulePeriod;
    await ctx
      .editMessageText(
        await scheduleText(db, ctx.dbUser, localeOf(ctx.dbUser, churchLocale), period),
        {
          parse_mode: 'HTML',
          link_preview_options: NO_PREVIEW,
          reply_markup: scheduleKeyboard(ctx.t, period),
        },
      )
      .catch(() => undefined);
    await ctx.answerCallbackQuery();
  });

  // Developers open the app as another role (a test person with that position).
  const testMenu = async (ctx: Ctx, groupId?: number) => {
    const t = ctx.t.testAs;
    const opts = await testOptions(db, ctx.dbUser);
    const kb = new InlineKeyboard();
    const group =
      groupId !== undefined
        ? opts.groups.find((g) => g.id === groupId)
        : opts.groups.length === 1
          ? opts.groups[0]
          : undefined;
    if (group) {
      for (const p of group.positions)
        kb.text(`${p.name} · ${t.rights(p.rights)}`, `ta:p:${p.id}`).row();
      kb.text(t.member, `ta:m:${group.id}`).row();
      kb.text(`⏳ ${t.pending}`, `ta:w:${group.id}`).row();
    } else for (const g of opts.groups) kb.text(`⛪ ${g.name}`, `ta:g:${g.id}`).row();
    if (groupId === undefined) {
      kb.text(`🙋 ${t.newcomer}`, 'ta:n').row();
      kb.text(`👑 ${t.admin}`, 'ta:a').row();
    } else if (opts.groups.length > 1) kb.text(t.back, 'ta:h').row();
    if (opts.current) kb.text(`↩️ ${t.exit}`, 'ta:x');
    const head =
      group && groupId !== undefined ? t.botChooseGroup(escapeHtml(group.name)) : t.botIntro;
    const text = opts.current ? `${head}\n\n${t.botCurrent(escapeHtml(opts.current))}` : head;
    return { text, kb };
  };

  pm.command('testas', async (ctx) => {
    if (!isDeveloper(env, ctx.dbUser)) return void (await ctx.reply(ctx.t.testAs.botOnlyDev));
    const { text, kb } = await testMenu(ctx);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  });

  pm.callbackQuery(/^ta:([hgpmwnax])(?::(\d+))?$/, async (ctx) => {
    if (!isDeveloper(env, ctx.dbUser))
      return void (await ctx.answerCallbackQuery({ text: ctx.t.testAs.botOnlyDev }));
    const [, what, raw] = ctx.match;
    const id = Number(raw);
    await ctx.answerCallbackQuery();
    if (what === 'h' || what === 'g') {
      const { text, kb } = await testMenu(ctx, what === 'g' ? id : undefined);
      await ctx
        .editMessageText(text, { parse_mode: 'HTML', reply_markup: kb })
        .catch(() => undefined);
      return;
    }
    if (what === 'x') {
      await stopTesting(db, ctx.dbUser);
      await ctx
        .editMessageText(ctx.t.testAs.botStopped, { reply_markup: openAppKeyboard(ctx.t) })
        .catch(() => undefined);
      return;
    }
    const input: TestAsInput =
      what === 'p'
        ? { kind: 'position', positionId: id }
        : what === 'm'
          ? { kind: 'member', groupId: id }
          : what === 'w'
            ? { kind: 'pending', groupId: id }
            : what === 'a'
              ? { kind: 'admin' }
              : { kind: 'newcomer' };
    const label = await startTesting(db, ctx.dbUser, input).catch(() => null);
    if (!label) return;
    const kb = new InlineKeyboard()
      .webApp(ctx.t.testAs.open, appUrl)
      .row()
      .text(ctx.t.testAs.change, 'ta:h')
      .text(`↩️ ${ctx.t.testAs.exit}`, 'ta:x');
    await ctx
      .editMessageText(ctx.t.testAs.botStarted(escapeHtml(label)), {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      .catch(() => undefined);
  });

  pm.command('help', async (ctx) => {
    await ctx.reply(ctx.t.bot.help);
  });

  pm.on('message', async (ctx) => {
    await ctx.reply(ctx.t.bot.help, { reply_markup: openAppKeyboard(ctx.t) });
  });

  bot.catch((err) => {
    console.error('bot error', err.error);
  });

  return bot;
}

async function handleClaim(ctx: Ctx, db: Db, code: string, keyboard: InlineKeyboard) {
  const result = await claimProfile(db, ctx.dbUser, code);
  if (result.kind !== 'claimed') {
    await ctx.reply(
      result.kind === 'invalid' ? ctx.t.bot.claimInvalid : ctx.t.bot.claimAccountInUse,
    );
    return;
  }
  ctx.dbUser = result.user;
  await ctx.reply(ctx.t.bot.claimDone(displayName(result.user)), { reply_markup: keyboard });
}

/** Commands shown in the Telegram menu (developers also get /testas, see bot/routes.ts). */
export function commandsFor(t: Messages) {
  return [
    { command: 'start', description: t.commands.start },
    { command: 'app', description: t.commands.app },
    { command: 'services', description: t.commands.services },
    { command: 'events', description: t.commands.events },
    { command: 'schedule', description: t.commands.schedule },
    { command: 'roster', description: t.commands.roster },
    { command: 'help', description: t.commands.help },
  ];
}
