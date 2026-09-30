import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiErrorBody } from '@church/shared';
import type { Env } from './env';
import { apiRoutes } from './api/routes';
import { botRoutes } from './bot/routes';
import { mediaRoutes } from './api/church';

export const app = new Hono<{ Bindings: Env }>();

app.get('/health', async (c) => {
  const deep = c.req.query('deep') === '1';
  let db: 'ok' | 'error' | 'skipped' = 'skipped';
  if (deep) {
    try {
      await c.env.DB.prepare('SELECT 1').first();
      db = 'ok';
    } catch {
      db = 'error';
    }
  }
  return c.json(
    { ok: db !== 'error', environment: c.env.ENVIRONMENT, db, time: new Date().toISOString() },
    db === 'error' ? 503 : 200,
  );
});

app.route('/bot', botRoutes);
app.route('/media', mediaRoutes);
app.route('/api', apiRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/bot/')) {
    return c.json<ApiErrorBody>({ error: { code: 'not_found', message: 'Not found' } }, 404);
  }
  // Everything else is the Mini App (static assets with SPA fallback).
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json<ApiErrorBody>(
      { error: { code: err.message || 'http_error', message: err.message } },
      err.status,
    );
  }
  console.error('unhandled error', err);
  return c.json<ApiErrorBody>({ error: { code: 'internal', message: 'Internal error' } }, 500);
});
