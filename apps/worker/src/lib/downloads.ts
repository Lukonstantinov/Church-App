import { and, eq, inArray, lt } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { Db } from '../db/client';
import { downloadParts, downloads } from '../db/schema';
import { hmacHex } from './media';

/** As much as the moving posters sent through the bot (lib/recorder.ts makes them). */
export const DOWNLOAD_MAX_BYTES = 45_000_000;
const PART_BYTES = 1_900_000;
const DAY_MS = 86_400_000;

/** What may be saved: the poster maker's own files, told by their first bytes. */
function kindOf(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
    return { mime: 'video/mp4', ext: 'mp4' };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return { mime: 'image/gif', ext: 'gif' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return { mime: 'image/png', ext: 'png' };
  return null;
}

/** Keeps a file for a day, in parts, and returns its row. */
export async function storeDownload(db: Db, userId: number, rawName: string, bytes: Uint8Array) {
  if (bytes.length === 0) throw new HTTPException(400, { message: 'empty' });
  if (bytes.length > DOWNLOAD_MAX_BYTES) throw new HTTPException(413, { message: 'too_large' });
  const kind = kindOf(bytes);
  if (!kind) throw new HTTPException(415, { message: 'unsupported_file' });
  const base = rawName.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 60) || 'poster';
  const parts = Math.ceil(bytes.length / PART_BYTES);
  const [row] = await db
    .insert(downloads)
    .values({ userId, name: `${base}.${kind.ext}`, mime: kind.mime, bytes: bytes.length, parts })
    .returning();
  for (let i = 0; i < parts; i++)
    await db.insert(downloadParts).values({
      downloadId: row!.id,
      idx: i,
      data: bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES),
    });
  return row!;
}

/** A link to it that works for a day (signed: the id alone opens nothing). */
export async function signedDownloadUrl(secret: string, id: number, now = Date.now()) {
  const exp = Math.floor((now + DAY_MS) / 1000);
  return `/media/d/${id}?e=${exp}&s=${await hmacHex(secret, `download:${id}.${exp}`)}`;
}

export async function verifyDownloadSignature(
  secret: string,
  id: number,
  exp: number,
  sig: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isSafeInteger(exp) || exp * 1000 < now) return false;
  return sig === (await hmacHex(secret, `download:${id}.${exp}`));
}

/** The file as a stream of its parts. */
export async function downloadStream(db: Db, id: number) {
  const meta = await db.query.downloads.findFirst({ where: eq(downloads.id, id) });
  if (!meta) return null;
  let idx = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (idx >= meta.parts) return controller.close();
      const part = await db.query.downloadParts.findFirst({
        where: and(eq(downloadParts.downloadId, id), eq(downloadParts.idx, idx)),
      });
      idx++;
      if (!part) return controller.error(new Error('missing part'));
      controller.enqueue(part.data);
    },
  });
  return { meta, body };
}

/** Files older than a day are gone (their links have run out anyway). */
export async function pruneDownloads(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const old = await db
    .select({ id: downloads.id })
    .from(downloads)
    .where(lt(downloads.createdAt, cutoff));
  if (old.length === 0) return;
  const ids = old.map((r) => r.id);
  await db.delete(downloadParts).where(inArray(downloadParts.downloadId, ids));
  await db.delete(downloads).where(inArray(downloads.id, ids));
}

/** A person's waiting files, for when the person themself is removed (their rows block it). */
export function forgetDownloadsOf(db: Db, userIds: number[]) {
  const theirs = db
    .select({ id: downloads.id })
    .from(downloads)
    .where(inArray(downloads.userId, userIds));
  return [
    db.delete(downloadParts).where(inArray(downloadParts.downloadId, theirs)),
    db.delete(downloads).where(inArray(downloads.userId, userIds)),
  ] as const;
}
