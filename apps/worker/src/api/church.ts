import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { LOGO_MAX_BYTES, updateChurchSchema, updateMeSchema } from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { getDb } from '../db/client';
import { churchSettings, users } from '../db/schema';
import { audit } from '../lib/audit';
import { getChurch, isValidTimezone } from '../lib/church';
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
  return c.json(await loadMe(db, { ...user, locale }));
});

/** /api/church — settings. Everyone can read; only admins change them. */
export const churchRoutes = new Hono<App>();

function requireAdmin(c: { get: (k: 'user') => AuthVariables['user'] }) {
  if (!c.get('user').isAdmin) throw new HTTPException(403, { message: 'forbidden' });
}

churchRoutes.get('/', async (c) => c.json(await getChurch(c.get('db'))));

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

/** Recognises PNG, JPEG and WebP by their first bytes (the Content-Type header is not trusted). */
export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

churchRoutes.put('/logo', async (c) => {
  requireAdmin(c);
  const db = c.get('db');
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > LOGO_MAX_BYTES) throw new HTTPException(413, { message: 'too_large' });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw new HTTPException(400, { message: 'empty' });
  if (bytes.length > LOGO_MAX_BYTES) throw new HTTPException(413, { message: 'too_large' });
  const mime = sniffImage(bytes);
  if (!mime) throw new HTTPException(415, { message: 'unsupported_image' });
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
  const bin = atob(row.logoData);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return c.body(bytes, 200, {
    'Content-Type': row.logoMime,
    'Cache-Control': c.req.query('v')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
});
