import { eq } from 'drizzle-orm';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { displayName, messages, type Messages } from '@church/shared';
import { adminTelegramIds, type Env } from '../env';
import { getDb, type Db } from '../db/client';
import { events, memberships, type User } from '../db/schema';
import { eventRoster, rosterMessage } from '../lib/eventRoster';
import { eventAccess } from '../lib/events';
import { acceptPrivacy, upsertTelegramUser } from '../lib/users';
import { churchDefaultLocale, localeOf } from '../lib/church';
import { getBotInfo } from '../lib/telegram';
import { DEEP_LINK } from '../lib/codes';
import { signedMediaUrl } from '../lib/media';
import {
  announceJoinDecision,
  decideJoin,
  notifyJoinRequest,
  requestJoin,
} from '../lib/membership';
import { can } from '../lib/access';
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
import { answerMeetingRole } from '../lib/meetingNotify';

export interface BotDeps {
  env: Env;
  /** Public HTTPS origin of the Mini App, e.g. https://church-app.example.workers.dev */
  appUrl: string;
}

type Ctx = Context & { dbUser: User; t: Messages };

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
      if (card.pictureId) {
        const photo = `${base}${await signedMediaUrl(env.WEBHOOK_SECRET, card.pictureId)}`;
        const fits = card.text.length <= 1024;
        const sent = await ctx
          .replyWithPhoto(photo, {
            caption: fits ? card.text : card.text.split('\n\n')[0],
            parse_mode: 'HTML',
            ...(fits ? { reply_markup } : {}),
          })
          .then(() => true)
          .catch(() => false);
        if (sent && fits) continue;
      }
      await ctx.reply(card.text, { parse_mode: 'HTML', reply_markup });
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
      reply_markup: scheduleKeyboard(ctx.t, 'w'),
    });
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
    await ctx.reply(rosterMessage(event, await eventRoster(db, event.id), locale), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().webApp(
        ctx.t.bot.eventButton,
        `${appUrl.replace(/\/+$/, '')}/?event=${event.id}`,
      ),
    });
  });

  pm.command('roster', async (ctx) => {
    await ctx.reply(await rosterText(db, ctx.dbUser, localeOf(ctx.dbUser, churchLocale)), {
      parse_mode: 'HTML',
      reply_markup: openAppKeyboard(ctx.t),
    });
  });

  pm.callbackQuery(/^sc:([wmq])$/, async (ctx) => {
    const period = ctx.match[1] as SchedulePeriod;
    await ctx
      .editMessageText(
        await scheduleText(db, ctx.dbUser, localeOf(ctx.dbUser, churchLocale), period),
        {
          parse_mode: 'HTML',
          reply_markup: scheduleKeyboard(ctx.t, period),
        },
      )
      .catch(() => undefined);
    await ctx.answerCallbackQuery();
  });

  pm.command('privacy', async (ctx) => {
    await ctx.reply(ctx.t.bot.privacyInfo, { parse_mode: 'HTML' });
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

/** Commands shown in the Telegram menu. Leader/admin scopes are added later. */
export function commandsFor(t: Messages) {
  return [
    { command: 'start', description: t.commands.start },
    { command: 'app', description: t.commands.app },
    { command: 'services', description: t.commands.services },
    { command: 'events', description: t.commands.events },
    { command: 'schedule', description: t.commands.schedule },
    { command: 'roster', description: t.commands.roster },
    { command: 'privacy', description: t.commands.privacy },
    { command: 'help', description: t.commands.help },
  ];
}
