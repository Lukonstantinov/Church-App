import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { ru } from '@church/shared';
import { adminTelegramIds, type Env } from '../env';
import { getDb } from '../db/client';
import { upsertTelegramUser } from '../lib/users';

/** getMe result cached per isolate so every webhook call doesn't cost an extra API request. */
let cachedBotInfo: { token: string; info: UserFromGetMe } | undefined;

export interface BotDeps {
  env: Env;
  /** Public HTTPS origin of the Mini App, e.g. https://church-app.example.workers.dev */
  appUrl: string;
}

export async function createBot({ env, appUrl }: BotDeps): Promise<Bot> {
  const bot = new Bot(env.BOT_TOKEN, {
    botInfo: cachedBotInfo?.token === env.BOT_TOKEN ? cachedBotInfo.info : undefined,
  });
  if (!bot.isInited()) {
    await bot.init();
    cachedBotInfo = { token: env.BOT_TOKEN, info: bot.botInfo };
  }

  const db = getDb(env.DB);
  const admins = adminTelegramIds(env);
  const openAppKeyboard = () => new InlineKeyboard().webApp(ru.bot.openApp, appUrl);

  // Only private chats are handled for now; group chats come later.
  const pm = bot.chatType('private');

  // Keep the stored profile fresh on every private interaction.
  pm.use(async (ctx: Context, next) => {
    if (ctx.from && !ctx.from.is_bot) await upsertTelegramUser(db, ctx.from, admins);
    await next();
  });

  pm.command('start', async (ctx) => {
    await ctx.reply(ru.bot.welcome(ctx.from.first_name), { reply_markup: openAppKeyboard() });
  });

  pm.command('app', async (ctx) => {
    await ctx.reply(ru.bot.openApp, { reply_markup: openAppKeyboard() });
  });

  pm.command('help', async (ctx) => {
    await ctx.reply(ru.bot.help);
  });

  pm.on('message', async (ctx) => {
    await ctx.reply(ru.bot.help, { reply_markup: openAppKeyboard() });
  });

  bot.catch((err) => {
    console.error('bot error', err.error);
  });

  return bot;
}

/** Commands shown in the Telegram menu for everyone. Leader/admin scopes are added later. */
export const defaultCommands = [
  { command: 'start', description: ru.commands.start },
  { command: 'app', description: ru.commands.app },
  { command: 'help', description: ru.commands.help },
];
