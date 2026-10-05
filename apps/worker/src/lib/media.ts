import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { InputFile } from 'grammy';
import type { Db } from '../db/client';
import { media } from '../db/schema';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Recognises PNG, JPEG and WebP by their first bytes (the Content-Type header is not trusted). */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
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

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Reads a raw image upload, enforcing the size cap and a real image type. */
export async function readImageUpload(
  req: { header: (n: string) => string | undefined; arrayBuffer: () => Promise<ArrayBuffer> },
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mime: ImageMime }> {
  const declared = Number(req.header('content-length') ?? 0);
  if (declared > maxBytes) throw new HTTPException(413, { message: 'too_large' });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) throw new HTTPException(400, { message: 'empty' });
  if (bytes.length > maxBytes) throw new HTTPException(413, { message: 'too_large' });
  const mime = sniffImage(bytes);
  if (!mime) throw new HTTPException(415, { message: 'unsupported_image' });
  return { bytes, mime };
}

const DAY_S = 86_400;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`media:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signed URL for a stored image, valid 1–2 days. The expiry is rounded to whole days so
 * the URL (and the browser cache) stays the same across requests on the same day.
 */
export async function signedMediaUrl(
  secret: string,
  id: number,
  now = Date.now(),
): Promise<string> {
  const exp = (Math.floor(now / 1000 / DAY_S) + 2) * DAY_S;
  return `/media/m/${id}?e=${exp}&s=${await hmacHex(secret, `${id}.${exp}`)}`;
}

export async function verifyMediaSignature(
  secret: string,
  id: number,
  exp: number,
  sig: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isSafeInteger(exp) || exp * 1000 < now) return false;
  const expected = await hmacHex(secret, `${id}.${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function storeMedia(
  db: Db,
  input: {
    groupId: number;
    kind: 'receipt' | 'event';
    bytes: Uint8Array;
    mime: ImageMime;
    createdBy: number;
  },
): Promise<number> {
  const [row] = await db
    .insert(media)
    .values({
      groupId: input.groupId,
      kind: input.kind,
      mime: input.mime,
      data: toBase64(input.bytes),
      bytes: input.bytes.length,
      createdBy: input.createdBy,
    })
    .returning({ id: media.id });
  return row!.id;
}

/** Ensures a media id exists and belongs to the group (so one group can't attach another's). */
export async function assertGroupMedia(db: Db, groupId: number, mediaId: number): Promise<void> {
  const row = await db.query.media.findFirst({
    columns: { id: true },
    where: and(eq(media.id, mediaId), eq(media.groupId, groupId)),
  });
  if (!row) throw new HTTPException(400, { message: 'invalid_media' });
}

/** Signed URL for a post attachment (separate namespace from images). */
export async function signedFileUrl(secret: string, id: number, now = Date.now()): Promise<string> {
  const exp = (Math.floor(now / 1000 / DAY_S) + 2) * DAY_S;
  return `/media/f/${id}?e=${exp}&s=${await hmacHex(secret, `file:${id}.${exp}`)}`;
}

export async function verifyFileSignature(
  secret: string,
  id: number,
  exp: number,
  sig: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isSafeInteger(exp) || exp * 1000 < now) return false;
  const expected = await hmacHex(secret, `file:${id}.${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * A stored picture as a file the bot uploads itself (Telegram then doesn't have to fetch a
 * link, which fails for some formats). Null when it's gone.
 */
export async function mediaFile(db: Db, id: number): Promise<InputFile | null> {
  const row = await db.query.media.findFirst({
    columns: { data: true, mime: true },
    where: eq(media.id, id),
  });
  if (!row) return null;
  return new InputFile(fromBase64(row.data), `picture.${EXT[row.mime] ?? 'jpg'}`);
}

/** Every speaker photo must be one of the ministry's own pictures. */
export async function assertSpeakerPhotos(
  db: Db,
  groupId: number,
  speakers: { mediaId?: number | null }[] | undefined,
): Promise<void> {
  for (const sp of speakers ?? []) if (sp.mediaId) await assertGroupMedia(db, groupId, sp.mediaId);
}
