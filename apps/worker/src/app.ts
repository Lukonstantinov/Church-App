import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { resolveBrand, type ApiErrorBody } from '@church/shared';
import { getDb } from './db/client';
import { getChurch } from './lib/church';
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

/** The app as a phone shortcut: the church's name, with its main photo (logo) as the icon. */
app.get('/manifest.webmanifest', async (c) => {
  const church = await getChurch(getDb(c.env.DB));
  const row = await getDb(c.env.DB).query.churchSettings.findFirst({
    columns: { logoMime: true },
  });
  const icons = church.logoUrl
    ? [
        {
          src: church.logoUrl,
          sizes: '192x192',
          type: row?.logoMime ?? 'image/png',
          purpose: 'any',
        },
        {
          src: church.logoUrl,
          sizes: '512x512',
          type: row?.logoMime ?? 'image/png',
          purpose: 'any',
        },
      ]
    : [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  return c.json(
    {
      name: church.name,
      short_name: church.name.slice(0, 12),
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: resolveBrand(church.brandColor).light,
      icons,
    },
    200,
    { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' },
  );
});

/** The church's main photo as the iPhone home-screen icon (falls back to the app icon). */
app.get('/apple-touch-icon.png', async (c) => {
  const church = await getChurch(getDb(c.env.DB));
  return c.redirect(church.logoUrl ?? '/icon.svg', 302);
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
