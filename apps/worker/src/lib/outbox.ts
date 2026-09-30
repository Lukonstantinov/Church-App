import { and, eq, lte } from 'drizzle-orm';
import { GrammyError, type Api } from 'grammy';
import type { Db } from '../db/client';
import { outbox, users } from '../db/schema';
import { isUnreachableError } from './telegram';

const MAX_ATTEMPTS = 5;

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
      const call = raw[row.method];
      if (!call) throw new Error(`unknown method ${row.method}`);
      await call.call(api.raw, row.payload);
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
