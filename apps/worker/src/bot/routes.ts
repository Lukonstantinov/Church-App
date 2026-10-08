import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { GrammyError, webhookCallback } from 'grammy';
import { adminTelegramIds, type Env } from '../env';
import { commandsFor, createBot } from './bot';
import { LOCALES, messages } from '@church/shared';
import { churchDefaultLocale } from '../lib/church';
import { deriveToken, timingSafeEqualStr } from '../lib/crypto';
import { appUrlFor } from '../lib/telegram';
import { getDb } from '../db/client';
import { churchSettings } from '../db/schema';

export const botRoutes = new Hono<{ Bindings: Env }>();

/** Telegram → Worker updates. grammY rejects requests without the correct secret header. */
botRoutes.post('/webhook', async (c) => {
  // Cheap early reject before touching the Telegram API.
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '';
  const webhookToken = await deriveToken(c.env.WEBHOOK_SECRET, 'webhook');
  if (!timingSafeEqualStr(secret, webhookToken)) {
    return c.json({ error: { code: 'forbidden', message: 'bad secret' } }, 401);
  }
  const bot = await createBot({ env: c.env, appUrl: appUrlFor(c.env, c.req.url) });
  const handle = webhookCallback(bot, 'cloudflare-mod', {
    secretToken: webhookToken,
  });
  return handle(c.req.raw);
});

/**
 * Called by the deploy workflow after each deploy: registers the webhook, the
 * command menu and the Mini App menu button. Idempotent. Auth: X-Setup-Secret.
 */
botRoutes.post('/setup', async (c) => {
  const provided = c.req.header('X-Setup-Secret') ?? '';
  if (
    !c.env.WEBHOOK_SECRET ||
    !timingSafeEqualStr(provided, await deriveToken(c.env.WEBHOOK_SECRET, 'setup'))
  ) {
    return c.json({ error: { code: 'forbidden', message: 'bad setup secret' } }, 403);
  }
  const appUrl = appUrlFor(c.env, c.req.url);

  // Report which step failed and why (Telegram's own description never contains secrets),
  // so a bad bot token or unreachable URL is obvious in the deploy log.
  let step = 'connect to Telegram (getMe)';
  try {
    const bot = await createBot({ env: c.env, appUrl });
    step = 'setWebhook';
    await bot.api.setWebhook(`${appUrl}/bot/webhook`, {
      secret_token: await deriveToken(c.env.WEBHOOK_SECRET, 'webhook'),
      allowed_updates: ['message', 'callback_query', 'my_chat_member', 'chat_join_request'],
      drop_pending_updates: false,
    });
    // Remember the public URL for cron jobs (they have no incoming request to read it from).
    step = 'saveAppUrl';
    await getDb(c.env.DB).update(churchSettings).set({ appUrl }).where(eq(churchSettings.id, 1));
    step = 'setMyCommands';
    // Default menu in the church language, plus a translated menu per Telegram UI language.
    const churchLocale = await churchDefaultLocale(getDb(c.env.DB));
    await bot.api.setMyCommands(commandsFor(messages(churchLocale)));
    for (const locale of LOCALES) {
      await bot.api.setMyCommands(commandsFor(messages(locale)), { language_code: locale });
    }
    // Developers' own chats also list /testas (open the app as another role). A developer
    // who hasn't started the bot yet has no chat: skipped.
    step = 'setDeveloperCommands';
    const t = messages(churchLocale);
    for (const id of adminTelegramIds(c.env)) {
      await bot.api
        .setMyCommands([...commandsFor(t), { command: 'testas', description: t.commands.testas }], {
          scope: { type: 'chat', chat_id: id },
        })
        .catch(() => undefined);
    }
    step = 'setChatMenuButton';
    await bot.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: messages(churchLocale).bot.menuButton,
        web_app: { url: appUrl },
      },
    });
    return c.json({ ok: true, webhook: `${appUrl}/bot/webhook`, bot: bot.botInfo.username });
  } catch (err) {
    const description =
      err instanceof GrammyError ? `${err.error_code} ${err.description}` : String(err);
    console.error('bot setup failed at', step, description);
    return c.json({ ok: false, failedStep: step, telegramError: description }, 502);
  }
});
