import type { Env } from './env';
import { app } from './app';
import { runScheduled } from './jobs/tick';

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduled(controller.cron, env).catch((err) => console.error('scheduled job failed', err)),
    );
  },
} satisfies ExportedHandler<Env>;
