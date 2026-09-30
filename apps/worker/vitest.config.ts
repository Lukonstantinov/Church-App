import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// The assets binding needs the directory to exist even when the Mini App isn't built.
mkdirSync(path.join(import.meta.dirname, '../webapp/dist'), { recursive: true });

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            BOT_TOKEN: '123456:TEST-TOKEN',
            WEBHOOK_SECRET: 'test-webhook-secret-0123456789abcdef',
            ADMIN_TELEGRAM_IDS: '1001',
            BOT_USERNAME: '', // force the getMe path (ignores a local .dev.vars value)
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
