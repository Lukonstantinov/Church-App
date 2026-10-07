import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import {
  LOGO_MAX_BYTES,
  MEDIA_MAX_BYTES,
  updateChurchSchema,
  churchStudioSchema,
  updateMeSchema,
} from '@church/shared';
import { isDeveloper, type Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { getDb } from '../db/client';
import { churchSettings, groups, media, users } from '../db/schema';
import { audit } from '../lib/audit';
import { getChurch, isValidTimezone } from '../lib/church';
import { fileStream } from '../lib/files';
import {
  fromBase64,
  readImageUpload,
  toBase64,
  verifyFileSignature,
  verifyMediaSignature,
} from '../lib/media';
import { loadMe } from '../lib/users';
import { parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** PATCH /api/me — the user's own preferences (language). */
export const meRoutes = new Hono<App>();

meRoutes.patch('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const { locale } = await parseBody(c, updateMeSchema);
  await db.update(users).set({ locale }).where(eq(users.id, user.id));
  return c.json(await loadMe(db, { ...user, locale }, isDeveloper(c.env, user)));
});

/** /api/church — settings. Everyone can read; only admins change them. */
export const churchRoutes = new Hono<App>();

function requireAdmin(c: { get: (k: 'user') => AuthVariables['user'] }) {
  if (!c.get('user').isAdmin) throw new HTTPException(403, { message: 'forbidden' });
}

churchRoutes.get('/', async (c) => c.json(await getChurch(c.get('db'))));

/** The Design studio saves the main page (its parts and background); church admins only. */
churchRoutes.put('/studio', async (c) => {
  requireAdmin(c);
  const db = c.get('db');
  const input = await parseBody(c, churchStudioSchema);
  // The main page's icon animations use the church logo or an emoji (no uploaded pictures).
  for (const part of Object.values(input.screenLook ?? {}))
    if (part) {
      if (part.icon) part.icon = { emoji: part.icon.emoji ?? null };
      // No uploaded pictures on the main page (they belong to a ministry).
      delete part.photo;
      delete part.photo2;
    }
  const patch: Partial<typeof churchSettings.$inferInsert> = {};
  if (input.screenLook !== undefined) patch.screenLook = input.screenLook;
  if (input.appBackground !== undefined) patch.appBackground = input.appBackground;
  if (Object.keys(patch).length > 0)
    await db.update(churchSettings).set(patch).where(eq(churchSettings.id, 1));
  // One background for the whole app: every ministry's pages get it too.
  if (input.everywhere && input.appBackground !== undefined)
    await db.update(groups).set({ pageBackground: input.appBackground });
  return c.json(await getChurch(db));
});

churchRoutes.patch('/', async (c) => {
  requireAdmin(c);
  const db = c.get('db');
  const input = await parseBody(c, updateChurchSchema);
  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    throw new HTTPException(400, { message: 'invalid_timezone' });
  }
  if (Object.keys(input).length > 0) {
    await db.update(churchSettings).set(input).where(eq(churchSettings.id, 1));
    await audit(db, {
      actorUserId: c.get('user').id,
      action: 'church_updated',
      entity: 'group',
      entityId: 0,
      data: input,
    });
  }
  return c.json(await getChurch(db));
});

churchRoutes.put('/logo', async (c) => {
  requireAdmin(c);
  const db = c.get('db');
  const { bytes, mime } = await readImageUpload(c.req, LOGO_MAX_BYTES);
  await db
    .update(churchSettings)
    .set({ logoData: toBase64(bytes), logoMime: mime, logoUpdatedAt: new Date().toISOString() })
    .where(eq(churchSettings.id, 1));
  await audit(db, {
    actorUserId: c.get('user').id,
    action: 'logo_updated',
    entity: 'group',
    entityId: 0,
  });
  return c.json(await getChurch(db));
});

/**
 * The bot's own profile photo, which Telegram also uses as the icon of the app's phone
 * shortcut. Body: a square JPEG (made in the browser). Sent straight to Telegram.
 */
churchRoutes.put('/bot-photo', async (c) => {
  requireAdmin(c);
  const { bytes, mime } = await readImageUpload(c.req, MEDIA_MAX_BYTES);
  if (mime !== 'image/jpeg') throw new HTTPException(400, { message: 'jpeg_only' });
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://file' }));
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/setMyProfilePhoto`, {
    method: 'POST',
    body: form,
  });
  const out = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
  if (!out.ok) throw new HTTPException(502, { message: 'telegram_failed' });
  await audit(c.get('db'), {
    actorUserId: c.get('user').id,
    action: 'bot_photo_updated',
    entity: 'group',
    entityId: 0,
  });
  return c.json({ ok: true });
});

churchRoutes.delete('/logo', async (c) => {
  requireAdmin(c);
  const db = c.get('db');
  await db
    .update(churchSettings)
    .set({ logoData: null, logoMime: null, logoUpdatedAt: null })
    .where(eq(churchSettings.id, 1));
  return c.json(await getChurch(db));
});

/** GET /media/logo — public, cacheable (the URL carries a version). */
export const mediaRoutes = new Hono<{ Bindings: Env }>();

mediaRoutes.get('/logo', async (c) => {
  const row = await getDb(c.env.DB).query.churchSettings.findFirst({
    columns: { logoData: true, logoMime: true },
  });
  if (!row?.logoData || !row.logoMime) return c.body(null, 404);
  return c.body(fromBase64(row.logoData), 200, {
    'Content-Type': row.logoMime,
    'Cache-Control': c.req.query('v')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
});

/** GET /media/m/:id?e=&s= — uploaded images (receipts, event photos) behind a signed URL. */
mediaRoutes.get('/m/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exp = Number(c.req.query('e'));
  const sig = c.req.query('s') ?? '';
  if (!Number.isSafeInteger(id) || id <= 0) return c.body(null, 404);
  if (!(await verifyMediaSignature(c.env.WEBHOOK_SECRET, id, exp, sig))) return c.body(null, 403);
  const row = await getDb(c.env.DB).query.media.findFirst({
    columns: { data: true, mime: true },
    where: eq(media.id, id),
  });
  if (!row) return c.body(null, 404);
  return c.body(fromBase64(row.data), 200, {
    'Content-Type': row.mime,
    'Cache-Control': 'private, max-age=86400, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
});

/** GET /media/g/:id/logo — an environment's logo (public like the church logo). */
mediaRoutes.get('/g/:id/logo', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.body(null, 404);
  const db = getDb(c.env.DB);
  const group = await db.query.groups.findFirst({
    columns: { logoMediaId: true },
    where: eq(groups.id, id),
  });
  if (!group?.logoMediaId) return c.body(null, 404);
  const row = await db.query.media.findFirst({
    columns: { data: true, mime: true },
    where: eq(media.id, group.logoMediaId),
  });
  if (!row) return c.body(null, 404);
  return c.body(fromBase64(row.data), 200, {
    'Content-Type': row.mime,
    'Cache-Control': c.req.query('v')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
});

/** GET /media/f/:id?e=&s= — a post attachment behind a signed URL, streamed in parts. */
mediaRoutes.get('/f/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exp = Number(c.req.query('e'));
  const sig = c.req.query('s') ?? '';
  if (!Number.isSafeInteger(id) || id <= 0) return c.body(null, 404);
  if (!(await verifyFileSignature(c.env.WEBHOOK_SECRET, id, exp, sig))) return c.body(null, 403);
  const file = await fileStream(getDb(c.env.DB), id);
  if (!file) return c.body(null, 404);
  const { meta, body } = file;
  // PDFs and pictures open in the viewer; other documents download.
  const inline = meta.mime === 'application/pdf' || meta.mime.startsWith('image/');
  const ascii = meta.name.replace(/[^\x20-\x7e]/g, '_');
  return new Response(body, {
    headers: {
      'Content-Type': meta.mime,
      'Content-Length': String(meta.bytes),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    },
  });
});
