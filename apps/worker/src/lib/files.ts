import { and, asc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { FILE_MAX_BYTES, FILE_TYPES, fileExtension } from '@church/shared';
import type { Db } from '../db/client';
import { fileParts, files } from '../db/schema';

/** D1 rows are capped at 2 MB, so files are stored in parts just under that. */
const PART_BYTES = 1_900_000;

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);

/** The extension decides the type, but the first bytes must agree with it. */
function contentMatches(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case 'pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpg':
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'webp':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]); // RIFF
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // zip
    case 'txt':
      return !bytes.subarray(0, 4096).includes(0);
    default:
      return false;
  }
}

/** Reads an upload, checks type and size, and stores it in parts. */
export async function storeFile(
  db: Db,
  req: { header: (n: string) => string | undefined; arrayBuffer: () => Promise<ArrayBuffer> },
  args: { groupId: number; name: string; userId: number },
) {
  const name = args.name
    .trim()
    .replace(/[\\/\r\n"]/g, '_')
    .slice(0, 120);
  const ext = fileExtension(name);
  const mime = FILE_TYPES[ext];
  if (!name || !mime) throw new HTTPException(415, { message: 'unsupported_file' });
  if (Number(req.header('content-length') ?? 0) > FILE_MAX_BYTES)
    throw new HTTPException(413, { message: 'too_large' });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) throw new HTTPException(400, { message: 'empty' });
  if (bytes.length > FILE_MAX_BYTES) throw new HTTPException(413, { message: 'too_large' });
  if (!contentMatches(ext, bytes)) throw new HTTPException(415, { message: 'unsupported_file' });

  const parts = Math.ceil(bytes.length / PART_BYTES);
  const [row] = await db
    .insert(files)
    .values({
      groupId: args.groupId,
      name,
      mime,
      bytes: bytes.length,
      parts,
      createdBy: args.userId,
    })
    .returning();
  for (let i = 0; i < parts; i++) {
    await db.insert(fileParts).values({
      fileId: row!.id,
      idx: i,
      data: bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES),
    });
  }
  return row!;
}

/** The file as a stream of its parts, read one at a time. */
export async function fileStream(db: Db, id: number) {
  const meta = await db.query.files.findFirst({ where: eq(files.id, id) });
  if (!meta) return null;
  let idx = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (idx >= meta.parts) return controller.close();
      const part = await db.query.fileParts.findFirst({
        where: and(eq(fileParts.fileId, id), eq(fileParts.idx, idx)),
      });
      idx++;
      if (!part) return controller.error(new Error('missing part'));
      controller.enqueue(part.data);
    },
  });
  return { meta, body };
}

export async function filesById(db: Db, ids: number[]) {
  if (ids.length === 0) return new Map<number, typeof files.$inferSelect>();
  const rows = await db.select().from(files).where(inArray(files.id, ids)).orderBy(asc(files.id));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function assertGroupFile(db: Db, groupId: number, fileId: number) {
  const row = await db.query.files.findFirst({
    columns: { id: true },
    where: and(eq(files.id, fileId), eq(files.groupId, groupId)),
  });
  if (!row) throw new HTTPException(400, { message: 'invalid_file' });
}
