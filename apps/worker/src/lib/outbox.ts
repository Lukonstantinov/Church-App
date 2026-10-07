import { and, eq, lte } from 'drizzle-orm';
import { GrammyError, type Api } from 'grammy';
import type { Db } from '../db/client';
import { livePins, outbox, users } from '../db/schema';
import { mediaFile } from './media';
import { isUnreachableError } from './telegram';

const MAX_ATTEMPTS = 5;

/**
 * A photo queued as `photo_media_id` (a stored picture) is uploaded by the bot when sent;
 * without the picture it goes as text.
 */
async function resolvePhoto(db: Db, method: string, payload: Record<string, unknown>) {
  if (method !== 'sendPhoto' || typeof payload.photo_media_id !== 'number')
    return { method, payload };
  const { photo_media_id: id, caption, ...rest } = payload;
  const file = await mediaFile(db, id as number);
  return file
    ? { method, payload: { ...rest, caption, photo: file } }
    : { method: 'sendMessage', payload: { ...rest, text: caption ?? '' } };
}

export interface OutboxMessage {
  chatId: number;
  /** Bot API method, e.g. "sendMessage". */
  method: string;
  payload: Record<string, unknown>;
  /** Queuing the same key twice is a no-op. */
  dedupeKey?: string;
}

export async function enqueue(db: Db, msg: OutboxMessage): Promise<boolean> {
  const rows = await db
    .insert(outbox)
    .values({
      chatId: msg.chatId,
      method: msg.method,
      payload: msg.payload,
      nextAttemptAt: new Date().toISOString(),
      dedupeKey: msg.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: outbox.id });
  return rows.length > 0;
}

/**
 * Sends due messages, at most `limit` per call (the Worker may make ~50 outgoing
 * requests per run, and Telegram allows ~30 messages/second overall).
 * - 429: waits Telegram's `retry_after` and stops this batch.
 * - a picture Telegram can't use: sent again as text.
 * - 403 (blocked the bot): message is dead, the user is marked unreachable.
 * - anything else: exponential backoff, dead after 5 attempts.
 */
export async function drainOutbox(
  db: Db,
  api: Api,
  { limit = 25, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<{ sent: number; failed: number }> {
  const due = await db
    .select()
    .from(outbox)
    .where(and(eq(outbox.status, 'pending'), lte(outbox.nextAttemptAt, now.toISOString())))
    .orderBy(outbox.id)
    .limit(limit);

  const raw = api.raw as unknown as Record<string, (p: unknown) => Promise<unknown>>;
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    try {
      // `_live`: pin the message once sent, and remember it so it is removed at the end.
      const { _live: live, ...stored } = row.payload as Record<string, unknown> & {
        _live?: { kind: 'meeting' | 'event'; refId: number; endsAt: string };
      };
      const { method, payload } = await resolvePhoto(db, row.method, stored);
      const call = raw[method];
      if (!call) throw new Error(`unknown method ${method}`);
      let sentMessage: unknown;
      try {
        sentMessage = await call.call(api.raw, payload);
      } catch (err) {
        // Telegram couldn't use the picture (bad file, unreachable link): the text still goes.
        if (!(method === 'sendPhoto' && err instanceof GrammyError && err.error_code === 400))
          throw err;
        const { photo: _photo, caption, ...rest } = payload;
        sentMessage = await raw.sendMessage!.call(api.raw, { ...rest, text: caption ?? '' });
      }
      const messageId = (sentMessage as { message_id?: number } | undefined)?.message_id;
      if (live && messageId) {
        await raw
          .pinChatMessage!.call(api.raw, {
            chat_id: row.chatId,
            message_id: messageId,
            disable_notification: true,
          })
          .catch(() => undefined);
        await db.insert(livePins).values({ chatId: row.chatId, messageId, ...live });
      }
      await db.update(outbox).set({ status: 'sent', lastError: null }).where(eq(outbox.id, row.id));
      sent++;
    } catch (err) {
      failed++;
      const description = err instanceof Error ? err.message : String(err);
      if (err instanceof GrammyError && err.error_code === 429) {
        const wait = (err.parameters?.retry_after ?? 5) + 1;
        await db
          .update(outbox)
          .set({
            nextAttemptAt: new Date(now.getTime() + wait * 1000).toISOString(),
            lastError: description,
          })
          .where(eq(outbox.id, row.id));
        break; // everyone is rate limited; try again on the next run
      }
      if (isUnreachableError(err)) {
        await db
          .update(outbox)
          .set({ status: 'dead', lastError: description })
          .where(eq(outbox.id, row.id));
        await db.update(users).set({ isReachable: false }).where(eq(users.telegramId, row.chatId));
        continue;
      }
      const attempts = row.attempts + 1;
      await db
        .update(outbox)
        .set(
          attempts >= MAX_ATTEMPTS
            ? { status: 'dead', attempts, lastError: description }
            : {
                attempts,
                lastError: description,
                nextAttemptAt: new Date(now.getTime() + 2 ** attempts * 60_000).toISOString(),
              },
        )
        .where(eq(outbox.id, row.id));
    }
  }
  return { sent, failed };
}

/** Takes down the pinned "LIVE" messages of meetings and events that have ended. */
export async function clearEndedLive(db: Db, api: Api, now = new Date()): Promise<number> {
  const ended = await db
    .select()
    .from(livePins)
    .where(lte(livePins.endsAt, now.toISOString()))
    .limit(40);
  const raw = api.raw as unknown as Record<string, (p: unknown) => Promise<unknown>>;
  for (const pin of ended) {
    const ref = { chat_id: pin.chatId, message_id: pin.messageId };
    // Either may fail (already removed by the person, or too old to delete): that's fine.
    await raw.unpinChatMessage!.call(api.raw, ref).catch(() => undefined);
    await raw.deleteMessage!.call(api.raw, ref).catch(() => undefined);
    await db.delete(livePins).where(eq(livePins.id, pin.id));
  }
  return ended.length;
}
