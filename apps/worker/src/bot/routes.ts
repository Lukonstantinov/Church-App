import { Hono } from 'hono';
import { GrammyError, webhookCallback } from 'grammy';
import type { Env } from '../env';
import { createBot, defaultCommands } from './bot';
import { timingSafeEqualStr } from '../lib/crypto';
import { appUrlFor } from '../lib/telegram';

export const botRoutes = new Hono<{ Bindings: Env }>();

/** Telegram → Worker updates. grammY rejects requests without the correct secret header. */
botRoutes.post('/webhook', async (c) => {
  // Cheap early reject before touching the Telegram API.
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!timingSafeEqualStr(secret, c.env.WEBHOOK_SECRET)) {
    return c.json({ error: { code: 'forbidden', message: 'bad secret' } }, 401);
  }
  const bot = await createBot({ env: c.env, appUrl: appUrlFor(c.env, c.req.url) });
  const handle = webhookCallback(bot, 'cloudflare-mod', {
    secretToken: c.env.WEBHOOK_SECRET,
  });
  return handle(c.req.raw);
});

/**
 * Called by the deploy workflow after each deploy: registers the webhook, the
 * command menu and the Mini App menu button. Idempotent. Auth: X-Setup-Secret.
 */
botRoutes.post('/setup', async (c) => {
  const provided = c.req.header('X-Setup-Secret') ?? '';
  if (!c.env.WEBHOOK_SECRET || !timingSafeEqualStr(provided, c.env.WEBHOOK_SECRET)) {
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
      secret_token: c.env.WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: false,
    });
    step = 'setMyCommands';
    await bot.api.setMyCommands(defaultCommands);
    step = 'setChatMenuButton';
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: appUrl } },
    });
    return c.json({ ok: true, webhook: `${appUrl}/bot/webhook`, bot: bot.botInfo.username });
  } catch (err) {
    const description =
      err instanceof GrammyError ? `${err.error_code} ${err.description}` : String(err);
    console.error('bot setup failed at', step, description);
    return c.json({ ok: false, failedStep: step, telegramError: description }, 502);
  }
});
