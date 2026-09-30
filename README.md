# Church Youth App

A Telegram bot and Mini App for church youth groups: members, roll-call attendance, group treasury and donations, and inactivity check-ins. It runs free on Cloudflare (Workers + D1).

See [docs/PLAN.md](docs/PLAN.md) for the full design and roadmap.

## Structure

```
apps/worker    Cloudflare Worker: REST API (/api), Telegram bot webhook (/bot), cron jobs
apps/webapp    React Mini App (served by the Worker as static assets)
packages/shared  Types, Russian UI strings, shared helpers
scripts/       Deploy and development helpers
```

## Setup (once)

### 1. Telegram

1. In **@BotFather**, send `/newbot` twice: a **test bot** for staging and the **real bot** for production. Save both tokens.
2. Get your numeric Telegram ID from **@userinfobot**, plus the ID of a second admin you trust.
3. After the first deploy (step 4), enable Mini App links for each bot:
   @BotFather → `/mybots` → your bot → **Bot Settings → Configure Mini App → Enable Mini App**.
   Use the Worker URL shown in the deploy summary.

### 2. Cloudflare (free plan)

1. Create an account at <https://dash.cloudflare.com>.
2. Open **Workers & Pages** once and choose a `workers.dev` subdomain. This is required before the first deploy.
3. **My Profile → API Tokens → Create Token**: use the **Edit Cloudflare Workers** template and add the permission **Account → D1 → Edit**.
4. Copy the token and your **Account ID** (shown on the Workers & Pages overview).

### 3. GitHub secrets

Add these under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret                   | Value                                                                   |
| ------------------------ | ----------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | token from step 2                                                       |
| `CLOUDFLARE_ACCOUNT_ID`  | account ID from step 2                                                  |
| `BOT_TOKEN_STAGING`      | test bot token                                                          |
| `BOT_TOKEN_PROD`         | real bot token                                                          |
| `WEBHOOK_SECRET_STAGING` | any random string, 32+ letters and digits                               |
| `WEBHOOK_SECRET_PROD`    | a different random string, 32+ letters and digits                       |
| `ADMIN_TELEGRAM_IDS`     | comma-separated Telegram IDs of church admins, e.g. `12345678,87654321` |

Optional **variables** (same page, _Variables_ tab): `APP_URL_STAGING` / `APP_URL_PROD`, only if you use a custom domain.

Never commit tokens or paste them into chats.

### 4. Deploy

- **Staging:** every push to `master` deploys automatically. The workflow creates the D1 database, runs migrations, deploys the Worker, uploads secrets and registers the bot webhook.
- **Production:** **Actions → Deploy → Run workflow → production**.

Check the result: open your bot in Telegram, send `/start` and tap **Открыть приложение** (Open app).

## Development

Requirements: Node 22+ and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test

# Local API + bot (http://localhost:8787), serving the built Mini App
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # fill in a test bot token
pnpm --filter worker db:migrate:local
pnpm build && pnpm dev:worker
```

To open the Mini App in a normal browser, generate signed test login data:

```sh
BOT_TOKEN=<same as .dev.vars> pnpm tsx scripts/dev-init-data.ts 12345678 Имя
# then open http://localhost:8787/#tgWebAppData=<url-encoded output>&tgWebAppVersion=8.0
```

Database schema changes: edit `apps/worker/src/db/schema.ts`, then `pnpm --filter worker db:generate` and commit the new file in `apps/worker/migrations/`.
