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
});
