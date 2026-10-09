import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupDetail, MemberRow } from '@church/shared';
import { env } from 'cloudflare:workers';
import { getDb } from '../src/db/client';
import { drainOutbox } from '../src/lib/outbox';
import { botApi } from '../src/lib/telegram';
import {
  ADMIN,
  api,
  apiJson,
  callsTo,
  fakeUser,
  mockTelegram,
  pressButton,
  sendText,
  type FakeTgUser,
  type TgCall,
} from './helpers';

let calls: TgCall[];
beforeEach(() => {
  calls = mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

async function createEnv(name: string) {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  const detail = await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
  return { id, inviteCode: new URL(detail.inviteLink!).searchParams.get('start')!.slice(2) };
}

async function join(user: FakeTgUser, g: { id: number; inviteCode: string }) {
  await sendText(user, `/start g_${g.inviteCode}`);
  await pressButton(user, `pv:g_${g.inviteCode}`);
  const row = (await apiJson<MemberRow[]>(`/api/groups/${g.id}/members`, { user: ADMIN })).find(
    (m) => m.firstName === user.first_name,
  )!;
  await apiJson(`/api/memberships/${row.membershipId}`, {
    method: 'PATCH',
    user: ADMIN,
    json: { status: 'active' },
  });
  return row;
}

const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);

describe('moving poster to others', () => {
  it('goes to the sender, then to chosen people or the whole ministry', async () => {
    const g = await createEnv('Постеры');
    const a = fakeUser('Аня');
    const b = fakeUser('Борис');
    const rowA = await join(a, g);
    await join(b, g);
    const { id: eventId } = await apiJson<{ id: number }>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Лагерь', date: '2030-07-01', startTime: '10:00' },
    });
    const send = (query: string, user = ADMIN) =>
      api(`/api/me/animation?name=x&caption=${encodeURIComponent('Лагерь!')}&${query}`, {
        method: 'POST',
        user,
        body: GIF,
      });
    const drain = () => drainOutbox(getDb(env.DB), botApi(env), { limit: 50 });

    calls.length = 0;
    const chosen = await send(`to=people&kind=event&id=${eventId}&users=${rowA.userId}`);
    expect(chosen.status).toBe(200);
    expect(((await chosen.json()) as { sent: number }).sent).toBe(1);
    await drain();
    const anims = callsTo(calls, 'sendAnimation');
    // The upload to the admin, then the same file to Аня only, with the caption.
    expect(anims.map((c) => c.body.chat_id)).toEqual([ADMIN.id, a.id]);
    expect(anims[1]!.body).toMatchObject({
      animation: expect.stringMatching(/^anim/),
      caption: 'Лагерь!',
    });

    calls.length = 0;
    const all = await send(`to=group&kind=event&id=${eventId}`);
    expect(((await all.json()) as { sent: number }).sent).toBe(2);
    await drain();
    expect(
      callsTo(calls, 'sendAnimation')
        .map((c) => c.body.chat_id)
        .sort(),
    ).toEqual([ADMIN.id, a.id, b.id].sort());

    // A plain member may only send it to themselves.
    expect((await send(`to=group&kind=event&id=${eventId}`, b)).status).toBe(403);
    expect((await send('to=me', b)).status).toBe(200);
  });

  it('a reminder can carry a moving poster recorded for it', async () => {
    const g = await createEnv('Напоминания');
    const a = fakeUser('Вера');
    await join(a, g);
    const { id: eventId } = await apiJson<{ id: number }>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Вечер', date: '2030-07-01', startTime: '19:00' },
    });
    const mp4 = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1]);
    const { id: posterMediaId } = (await (
      await api(`/api/groups/${g.id}/loops`, { method: 'POST', user: ADMIN, body: mp4 })
    ).json()) as { id: number };
    calls.length = 0;
    await apiJson(`/api/events/${eventId}/remind`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'Ждём вас!', posterMediaId },
    });
    await drainOutbox(getDb(env.DB), botApi(env), { limit: 50 });
    // Played as an animation in the chat, with the reminder under it.
    const anim = callsTo(calls, 'sendAnimation').find((c) => c.body.chat_id === a.id);
    expect(anim).toBeTruthy();
    expect(String(anim!.body.caption)).toContain('Ждём вас!');
    // Another ministry's video can't be used.
    const other = await createEnv('Чужие');
    const { id: theirs } = (await (
      await api(`/api/groups/${other.id}/loops`, { method: 'POST', user: ADMIN, body: mp4 })
    ).json()) as { id: number };
    const res = await api(`/api/events/${eventId}/remind`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'x', posterMediaId: theirs },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('effect templates', () => {
  it('designers save, share and delete sets of effects; others may not change them', async () => {
    const set = {
      name: 'Дым и искры',
      effects: [
        { kind: 'smoke', tune: { speed: 1.5 } },
        { kind: 'sparkle', tune: null },
      ],
    };
    const made = await apiJson<{ id: number; mine: boolean }>('/api/effect-templates', {
      method: 'POST',
      user: ADMIN,
      json: set,
    });
    expect(made.mine).toBe(true);
    const list = await apiJson<{ name: string; effects: { kind: string }[] }[]>(
      '/api/effect-templates',
      { user: ADMIN },
    );
    expect(list.at(-1)).toMatchObject({ name: 'Дым и искры' });
    expect(list.at(-1)!.effects.map((e) => e.kind)).toEqual(['smoke', 'sparkle']);
    // More than eight at once is refused.
    const many = await api('/api/effect-templates', {
      method: 'POST',
      user: ADMIN,
      json: { name: 'x', effects: Array.from({ length: 9 }, () => ({ kind: 'snow' })) },
    });
    expect(many.status).toBe(400);
    // Someone without design rights sees none of it.
    const g = await createEnv('Эффекты');
    const m = fakeUser('Мила');
    await join(m, g);
    expect((await api('/api/effect-templates', { user: m })).status).toBe(403);
    await apiJson(`/api/effect-templates/${made.id}`, { method: 'DELETE', user: ADMIN });
    const after = await apiJson<{ id: number }[]>('/api/effect-templates', { user: ADMIN });
    expect(after.some((x) => x.id === made.id)).toBe(false);
  });
});
