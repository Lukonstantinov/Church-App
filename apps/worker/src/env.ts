export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  /** Telegram bot token from @BotFather (secret). */
  BOT_TOKEN: string;
  /** Random string: Telegram webhook secret_token and /bot/setup auth (secret). */
  WEBHOOK_SECRET: string;
  /** Comma-separated Telegram user ids that are always church admins (secret). */
  ADMIN_TELEGRAM_IDS?: string;
  /** Optional: bot @username without "@". Skips a getMe call; required for offline local dev. */
  BOT_USERNAME?: string;
  /** Optional public URL override (custom domain). Defaults to the request origin. */
  APP_URL?: string;
}

export function adminTelegramIds(env: Env): Set<number> {
  return new Set(
    (env.ADMIN_TELEGRAM_IDS ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isSafeInteger(n) && n > 0),
  );
}
