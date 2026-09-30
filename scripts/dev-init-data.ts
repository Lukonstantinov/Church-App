/**
 * Prints a signed Telegram initData string for local development/testing.
 *
 *   BOT_TOKEN=123:abc pnpm tsx scripts/dev-init-data.ts [telegramId] [firstName]
 *
 * Use it as VITE_DEV_INIT_DATA, or open the app at
 *   http://localhost:8787/#tgWebAppData=<encodeURIComponent(output)>&tgWebAppVersion=8.0
 */
import { signInitData } from '../apps/worker/src/auth/initData';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN env var is required');
  process.exit(1);
}
const id = Number(process.argv[2] ?? 1001);
const firstName = process.argv[3] ?? 'Разработчик';

const fields: Record<string, string> = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'dev',
  user: JSON.stringify({ id, first_name: firstName, language_code: 'ru' }),
};
const hash = await signInitData(fields, token);
console.log(new URLSearchParams({ ...fields, hash }).toString());
