import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { Api } from 'grammy';
import { addDays, localDate, type MeetingRow } from '@church/shared';
import { getDb } from '../src/db/client';
import { drainOutbox, enqueue } from '../src/lib/outbox';
import { pruneReminderVideos } from '../src/lib/media';
import { hourlyTick, runScheduled, CRON_HOURLY } from '../src/jobs/tick';
import { ADMIN, apiJson, callsTo, mockTelegram, type TgCall } from './helpers';

let calls: TgCall[];
beforeEach(() => {
  calls = mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

const db = () => getDb(env.DB);
const outboxRows = () =>
  env.DB.prepare('SELECT chat_id, status, dedupe_key, attempts FROM outbox ORDER BY id').all<{
    chat_id: number;
    status: string;
    dedupe_key: string | null;
    attempts: number;
  }>();

/** A group with an ended, unrolled meeting `hoursAgo` hours after it finished. */
async function groupWithEndedMeeting(hoursAgo: number) {
  await apiJson('/api/me', { user: ADMIN }); // makes sure the admin has a Telegram chat
  const { id: groupId } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name: `Напоминания ${hoursAgo}` },
  });
  const meeting = await apiJson<MeetingRow>(`/api/groups/${groupId}/meetings`, {
    method: 'POST',
    user: ADMIN,
    json: {
      date: addDays(localDate(new Date(), 'Europe/Riga'), -1),
      startTime: '10:00',
      durationMin: 60,
      title: 'Утро',
    },
  });
  // Move the meeting so it ended exactly `hoursAgo` hours ago.
  const end = new Date(Date.now() - hoursAgo * 3_600_000);
  await env.DB.prepare('UPDATE meetings SET starts_at = ?, ends_at = ? WHERE id = ?')
    .bind(new Date(end.getTime() - 3_600_000).toISOString(), end.toISOString(), meeting.id)
    .run();
  return { groupId, meetingId: meeting.id };
}

describe('roll-call reminders', () => {
  it('queues one reminder per recipient after an hour, only once, with a deep link', async () => {
    await env.DB.prepare(
      "UPDATE church_settings SET app_url = 'https://app.test' WHERE id = 1",
    ).run();
    const { meetingId } = await groupWithEndedMeeting(2);

    await hourlyTick(env);
    await hourlyTick(env); // a second tick must not queue it again
    const queued = (await outboxRows()).results.filter((r) =>
      r.dedupe_key?.startsWith(`roll:${meetingId}:`),
    );
    expect(queued).toHaveLength(1); // no leaders → the single admin

    await runScheduled(CRON_HOURLY, env);
    const sent = callsTo(calls, 'sendMessage', ADMIN.id).at(-1)!;
    expect(String(sent.body.text)).toContain('Отметьте посещаемость');
    expect(String(sent.body.text)).toContain('Утро');
    expect(JSON.stringify(sent.body.reply_markup)).toContain(`https://app.test/?roll=${meetingId}`);
    const after = (await outboxRows()).results.filter(
      (r) => r.dedupe_key === `roll:${meetingId}:${ADMIN.id}`,
    );
    expect(after[0]?.status).toBe('sent');
  });

  it('does not remind before an hour has passed', async () => {
    const { meetingId } = await groupWithEndedMeeting(0.5);
    await hourlyTick(env);
    const queued = (await outboxRows()).results.filter((r) =>
      r.dedupe_key?.startsWith(`roll:${meetingId}:`),
    );
    expect(queued).toHaveLength(0);
  });

  it('does not remind about meetings that already have a roll call', async () => {
    const { meetingId } = await groupWithEndedMeeting(3);
    await env.DB.prepare("UPDATE meetings SET status = 'done' WHERE id = ?").bind(meetingId).run();
    await hourlyTick(env);
    const queued = (await outboxRows()).results.filter((r) =>
      r.dedupe_key?.startsWith(`roll:${meetingId}:`),
    );
    expect(queued).toHaveLength(0);
  });
});

describe('outbox', () => {
  const api = () => new Api(env.BOT_TOKEN);

  it('ignores duplicate dedupe keys', async () => {
    const msg = {
      chatId: 42,
      method: 'sendMessage',
      payload: { chat_id: 42, text: 'hi' },
      dedupeKey: 'dup:1',
    };
    expect(await enqueue(db(), msg)).toBe(true);
    expect(await enqueue(db(), msg)).toBe(false);
  });

  it('marks a blocked user unreachable and drops the message', async () => {
    await env.DB.prepare(
      "INSERT INTO users (telegram_id, first_name) VALUES (777, 'Заблокировал')",
    ).run();
    await enqueue(db(), {
      chatId: 777,
      method: 'sendMessage',
      payload: { chat_id: 777, text: 'x' },
      dedupeKey: 'blocked:1',
    });
    vi.unstubAllGlobals();
    calls = mockTelegram({ failFor: [777] });
    await drainOutbox(db(), api());
    const row = (await outboxRows()).results.find((r) => r.dedupe_key === 'blocked:1');
    expect(row?.status).toBe('dead');
    const user = await env.DB.prepare(
      'SELECT is_reachable FROM users WHERE telegram_id = 777',
    ).first<{ is_reachable: number }>();
    expect(user?.is_reachable).toBe(0);
  });

  it('backs off on rate limits and stops the batch', async () => {
    await enqueue(db(), {
      chatId: 801,
      method: 'sendMessage',
      payload: { chat_id: 801, text: 'a' },
      dedupeKey: 'rl:1',
    });
    await enqueue(db(), {
      chatId: 802,
      method: 'sendMessage',
      payload: { chat_id: 802, text: 'b' },
      dedupeKey: 'rl:2',
    });
    const seen: number[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { chat_id?: number };
      if (body.chat_id) seen.push(body.chat_id);
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 30 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const now = new Date();
    await drainOutbox(db(), api(), { now });
    expect(seen).toEqual([801]); // stopped after the first 429
    const row = await env.DB.prepare(
      "SELECT status, next_attempt_at FROM outbox WHERE dedupe_key = 'rl:1'",
    ).first<{
      status: string;
      next_attempt_at: string;
    }>();
    expect(row?.status).toBe('pending');
    expect(new Date(row!.next_attempt_at).getTime()).toBeGreaterThan(now.getTime() + 30_000);
  });

  it('retries other failures with backoff and gives up after five attempts', async () => {
    await enqueue(db(), {
      chatId: 901,
      method: 'sendMessage',
      payload: { chat_id: 901, text: 'z' },
      dedupeKey: 'err:1',
    });
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }));
    let now = new Date();
    for (let i = 0; i < 5; i++) {
      await drainOutbox(db(), api(), { now });
      now = new Date(now.getTime() + 24 * 3_600_000); // jump past the backoff each time
    }
    const row = (await outboxRows()).results.find((r) => r.dedupe_key === 'err:1');
    expect(row).toMatchObject({ status: 'dead', attempts: 5 });
  });

  it('two drains running at once send each message only once', async () => {
    for (let i = 0; i < 3; i++)
      await enqueue(db(), {
        chatId: 950 + i,
        method: 'sendMessage',
        payload: { chat_id: 950 + i, text: 'once' },
        dedupeKey: `race:${i}`,
      });
    await Promise.all([drainOutbox(db(), api()), drainOutbox(db(), api())]);
    expect(callsTo(calls, 'sendMessage').filter((c) => c.body.text === 'once')).toHaveLength(3);
  });

  it("uploads a moving poster once and sends the others by Telegram's file id", async () => {
    const { id } = (await env.DB.prepare(
      "INSERT INTO media (kind, mime, data, bytes) VALUES ('reminder', 'video/mp4', 'AAAAAGZ0eXA=', 8) RETURNING id",
    ).first<{ id: number }>())!;
    for (const chat of [960, 961, 962])
      await enqueue(db(), {
        chatId: chat,
        method: 'sendPhoto',
        payload: { chat_id: chat, photo_media_id: id, caption: 'hi' },
        dedupeKey: `anim:${chat}`,
      });
    await drainOutbox(db(), api());
    const sent = callsTo(calls, 'sendAnimation');
    expect(sent).toHaveLength(3);
    expect(sent[0]!.body.animation).toEqual({ upload: true });
    expect(sent[1]!.body.animation).toMatch(/^anim/);
    expect(sent[2]!.body.animation).toBe(sent[1]!.body.animation);
  });

  it('old reminder videos are removed, but not ones still in use or other media', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const add = async (kind: string) =>
      (await env.DB.prepare(
        "INSERT INTO media (kind, mime, data, bytes, created_at) VALUES (?, 'video/mp4', 'AA==', 1, ?) RETURNING id",
      )
        .bind(kind, old)
        .first<{ id: number }>())!.id;
    const gone = await add('reminder');
    const kept = await add('event');
    await pruneReminderVideos(db());
    const left = (
      await env.DB.prepare('SELECT id FROM media WHERE id IN (?, ?)')
        .bind(gone, kept)
        .all<{ id: number }>()
    ).results.map((r) => r.id);
    expect(left).toEqual([kept]);
  });
});
