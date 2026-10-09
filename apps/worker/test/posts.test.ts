import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BACKDROP,
  DEFAULT_PATTERN,
  type AnnouncementResult,
  type AnnouncementRow,
  type GroupDetail,
  type MemberRow,
  type PostBlockView,
} from '@church/shared';
import {
  ADMIN,
  api,
  apiJson,
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

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (ch) => ch.charCodeAt(0),
);

async function createEnv(name: string) {
  const { id } = await apiJson<{ id: number }>('/api/groups', {
    method: 'POST',
    user: ADMIN,
    json: { name },
  });
  const d = await apiJson<GroupDetail>(`/api/groups/${id}`, { user: ADMIN });
  return { id, inviteCode: new URL(d.inviteLink!).searchParams.get('start')!.slice(2) };
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
}

const upload = async (groupId: number) =>
  (
    (await (
      await api(`/api/groups/${groupId}/media?kind=event`, {
        method: 'POST',
        user: ADMIN,
        body: PNG,
      })
    ).json()) as { id: number }
  ).id;

const post = (groupId: number, json: unknown, user = ADMIN) =>
  apiJson<AnnouncementResult>(`/api/groups/${groupId}/announcements`, {
    method: 'POST',
    user,
    json,
  });
const feedOf = (groupId: number, user: FakeTgUser) =>
  apiJson<AnnouncementRow[]>(`/api/groups/${groupId}/announcements`, { user });
const block = <T extends PostBlockView['type']>(row: AnnouncementRow, type: T) =>
  row.blocks.find((b) => b.type === type) as Extract<PostBlockView, { type: T }>;

async function uploadFile(groupId: number, name: string, bytes: Uint8Array) {
  return api(`/api/groups/${groupId}/files?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    user: ADMIN,
    body: bytes,
  });
}

describe('rich posts', () => {
  it('design: type, own colour, no ministry photo, fonts; ministry look by default', async () => {
    const g = await createEnv('Дизайн постов');
    const photo = await upload(g.id);
    await apiJson(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: {
        brandColor: 'ocean',
        backdrop: { ...DEFAULT_BACKDROP, mediaId: photo, split: 'right' },
      },
    });
    const plain = await post(g.id, { text: 'Обычный', notify: false });
    expect(plain.announcement.design).toBeNull();
    expect(plain.announcement.look).toMatchObject({ brandColor: 'ocean' });
    expect(plain.announcement.look!.backdrop).toMatchObject({ split: 'right' });

    const styled = await post(g.id, {
      title: 'Молитва',
      text: 'Вечер молитвы',
      notify: false,
      design: {
        kind: 'prayer',
        brandColor: 'lavender',
        noBackdrop: true,
        titleFont: 'lobster',
        bodyFont: 'lora',
        titleSize: 'xl',
        titlePos: 'center',
        align: 'center',
      },
    });
    expect(styled.announcement.look).toMatchObject({ brandColor: 'lavender', backdrop: null });
    expect(styled.announcement.design).toMatchObject({
      kind: 'prayer',
      banner: true,
      titleFont: 'lobster',
    });

    const own = await post(g.id, {
      text: 'Свой вид',
      notify: false,
      design: {
        custom: {
          pattern: { ...DEFAULT_PATTERN, value: '🔥' },
          backdrop: { ...DEFAULT_BACKDROP, mediaId: photo },
          textColor: 'dark',
        },
      },
    });
    expect(own.announcement.look).toMatchObject({ textColor: 'dark' });
    expect(own.announcement.look!.pattern!.value).toBe('🔥');

    const bad = await api(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'x', notify: false, design: { titleFont: 'comic-sans' } },
    });
    expect(bad.status).toBe(400);
  });

  it('a post can carry moving effects and a moving poster for the bot message', async () => {
    const g = await createEnv('Живые посты');
    const mp4 = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1]);
    const { id: posterMediaId } = (await (
      await api(`/api/groups/${g.id}/loops`, { method: 'POST', user: ADMIN, body: mp4 })
    ).json()) as { id: number };
    await post(g.id, {
      title: 'Вечер хвалы',
      text: 'Ждём всех',
      posterMediaId,
      design: {
        banner: true,
        effects: {
          motion: 'smoke',
          motionTune: { color: '#ec4899' },
          motionLayers: [{ kind: 'smoke', tune: { angle: 180 } }],
        },
      },
    });
    const [row] = await feedOf(g.id, ADMIN);
    expect(row!.design?.effects).toMatchObject({
      motion: 'smoke',
      motionLayers: [{ kind: 'smoke', tune: { angle: 180 } }],
    });
    // The moving poster plays from its public link.
    expect(row!.posterMoving).toBe(true);
    expect(row!.posterUrl).toBe(`/media/v/${posterMediaId}`);
  });

  it('blocks: pictures, tables, files in parts, polls and quizzes', async () => {
    const g = await createEnv('Блоки');
    const m = fakeUser('Голосующий');
    await join(m, g);
    const pic = await upload(g.id);

    // A 4.5 MB PDF is stored in three parts and comes back byte for byte.
    const pdf = new Uint8Array(4_500_000);
    pdf.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    for (let i = 6; i < pdf.length; i++) pdf[i] = i % 251;
    const up = await uploadFile(g.id, 'Расписание лагеря.pdf', pdf);
    expect(up.status).toBe(201);
    const file = (await up.json()) as { id: number; url: string; bytes: number };
    expect(file.bytes).toBe(pdf.length);
    const dl = await api(file.url);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(dl.headers.get('content-disposition')).toContain('inline');
    const back = new Uint8Array(await dl.arrayBuffer());
    expect(back.length).toBe(pdf.length);
    expect(back[3_000_123]).toBe(pdf[3_000_123]);
    expect(back[pdf.length - 1]).toBe(pdf[pdf.length - 1]);
    expect((await api(file.url.replace(/s=[^&]+/, 's=bad'))).status).toBe(403);

    // Wrong content for the extension, and unknown types, are refused.
    expect((await uploadFile(g.id, 'fake.pdf', new Uint8Array([1, 2, 3, 4]))).status).toBe(415);
    expect((await uploadFile(g.id, 'page.html', new Uint8Array([60, 104]))).status).toBe(415);

    const res = await post(g.id, {
      title: 'Всё в одном',
      text: 'Смотрите https://example.org',
      notify: false,
      blocks: [
        { id: 'img1', type: 'image', mediaId: pic, caption: 'Скриншот' },
        {
          id: 'tab1',
          type: 'table',
          header: true,
          rows: [
            ['День', 'Кто'],
            ['Пт', 'Мария'],
          ],
        },
        { id: 'fil1', type: 'file', fileId: file.id, name: 'Расписание лагеря.pdf' },
        {
          id: 'pol1',
          type: 'poll',
          question: 'Когда?',
          options: ['Пт', 'Сб', 'Вс'],
          multiple: true,
        },
        {
          id: 'qui1',
          type: 'quiz',
          question: 'Сколько апостолов?',
          options: ['7', '12'],
          correct: 1,
          explanation: 'Мк 3:14',
        },
        { id: 'txt1', type: 'text', text: 'P.S. Берите Библию' },
      ],
    });
    const id = res.announcement.id;
    expect(block(res.announcement, 'image').url).toMatch(/^\/media\/m\//);
    expect(block(res.announcement, 'file')).toMatchObject({
      bytes: pdf.length,
      mime: 'application/pdf',
    });

    // Members don't see the quiz answer until they answer.
    let row = (await feedOf(g.id, m)).find((p) => p.id === id)!;
    expect(block(row, 'quiz').correct).toBeNull();

    const vote = (json: unknown, user = m) =>
      api(`/api/announcements/${id}/vote`, { method: 'POST', user, json });
    expect((await vote({ blockId: 'pol1', options: [0, 2] })).status).toBe(200);
    expect((await vote({ blockId: 'pol1', options: [1] })).status).toBe(200); // changed mind
    expect((await vote({ blockId: 'pol1', options: [0, 2] }, ADMIN)).status).toBe(200);
    expect((await vote({ blockId: 'pol1', options: [5] })).status).toBe(400);
    expect((await vote({ blockId: 'qui1', options: [0, 1] })).status).toBe(400);
    expect((await vote({ blockId: 'qui1', options: [0] })).status).toBe(200);
    expect((await vote({ blockId: 'qui1', options: [1] })).status).toBe(409); // final

    row = (await feedOf(g.id, m)).find((p) => p.id === id)!;
    expect(block(row, 'poll').results).toEqual({ counts: [1, 1, 1], mine: [1], voters: 2 });
    // Leaders (the author here) also see who chose what.
    const lead = (await feedOf(g.id, ADMIN)).find((p) => p.id === id)!;
    const who = block(lead, 'poll').results.who!;
    expect(who[1]!.map((p) => p.firstName)).toEqual(['Голосующий']);
    expect(who[0]!).toHaveLength(1);
    expect(block(row, 'quiz')).toMatchObject({ correct: 1, explanation: 'Мк 3:14' });
    expect(block(row, 'quiz').results).toMatchObject({ counts: [1, 0], mine: [0], voters: 1 });

    // Media and files from another ministry can't be used.
    const other = await createEnv('Чужие файлы');
    const foreign = await post(other.id, { text: 'x', notify: false }).catch(() => null);
    expect(foreign).not.toBeNull();
    const steal = await api(`/api/groups/${other.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: {
        text: 'x',
        notify: false,
        blocks: [{ id: 'fil1', type: 'file', fileId: file.id, name: 'a.pdf' }],
      },
    });
    expect(steal.status).toBe(400);
  });

  it('a post needs some content, and the bot points to attachments', async () => {
    const g = await createEnv('Пустые');
    const m = fakeUser('Получатель');
    await join(m, g);
    const empty = await api(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { text: '', notify: false },
    });
    expect(empty.status).toBe(400);
    calls.length = 0;
    await post(g.id, {
      text: '',
      blocks: [{ id: 'pol9', type: 'poll', question: 'Пицца?', options: ['Да', 'Нет'] }],
    });
    await new Promise((r) => setTimeout(r, 50));
    const sent = calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.body.text));
    expect(sent.some((t) => t.includes('откройте приложение'))).toBe(true);
  });
});
