import { eq } from 'drizzle-orm';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { displayName, messages, type Messages } from '@church/shared';
import { adminTelegramIds, type Env } from '../env';
import { getDb, type Db } from '../db/client';
import { memberships, type User } from '../db/schema';
import { acceptPrivacy, upsertTelegramUser } from '../lib/users';
import { churchDefaultLocale, localeOf } from '../lib/church';
import { getBotInfo } from '../lib/telegram';
import { DEEP_LINK } from '../lib/codes';
import {
  announceJoinDecision,
  decideJoin,
  notifyJoinRequest,
  requestJoin,
} from '../lib/membership';
import { canManageGroup } from '../lib/access';
import { claimProfile } from '../lib/claim';

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

  // Only private chats are handled for now; group chats come later.
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
    if (!membership || !(await canManageGroup(db, ctx.dbUser, membership.groupId))) {
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

  pm.command('app', async (ctx) => {
    await ctx.reply(ctx.t.bot.openApp, { reply_markup: openAppKeyboard(ctx.t) });
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
    { command: 'privacy', description: t.commands.privacy },
    { command: 'help', description: t.commands.help },
  ];
}
