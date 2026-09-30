import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PATTERN,
  type AnnouncementResult,
  type AnnouncementRow,
  type CommentRow,
  type DesignTemplate,
  type EventDetail,
  type EventSummary,
  type GroupDetail,
  type GroupSummary,
  type MemberRow,
} from '@church/shared';
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

const summaryFor = async (user: FakeTgUser, groupId: number) =>
  (await apiJson<GroupSummary[]>('/api/groups', { user })).find((g) => g.id === groupId)!;

describe('ministry feed', () => {
  it('posters with photos and tint; the bot sends the first photo with the text', async () => {
    const g = await createEnv('Лента');
    const m = fakeUser('Читатель');
    await join(m, g);
    const photos = [await upload(g.id), await upload(g.id)];
    const res = await apiJson<AnnouncementResult>(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Лагерь 2026',
        text: 'Записывайтесь до пятницы!',
        mediaIds: photos,
        tintColor: '#1e293b',
        tintStrength: 0.4,
      },
    });
    expect(res.announcement).toMatchObject({
      title: 'Лагерь 2026',
      tint: { color: '#1e293b', strength: 0.4 },
      commentCount: 0,
    });
    expect(res.announcement.photos).toHaveLength(2);
    const sent = callsTo(calls, 'sendPhoto', m.id);
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.body.caption)).toContain('Лагерь 2026');
    expect(String(sent[0]!.body.photo)).toMatch(/\/media\/m\/\d+\?e=/);

    const feed = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, { user: m });
    expect(feed[0]!.photos.map((p) => p.id)).toEqual(photos);
    expect(feed[0]!.canDelete).toBe(false);
  });

  it('reactions toggle; comments form a small chat; authors and moderators delete', async () => {
    const g = await createEnv('Реакции');
    const a = fakeUser('Аня');
    const b = fakeUser('Борис');
    await join(a, g);
    await join(b, g);
    const { announcement } = await apiJson<AnnouncementResult>(
      `/api/groups/${g.id}/announcements`,
      { method: 'POST', user: ADMIN, json: { text: 'Кто придёт?', notify: false } },
    );
    expect(
      callsTo(calls, 'sendMessage', a.id).filter((c) => String(c.body.text).includes('Кто придёт')),
    ).toHaveLength(0);
    const react = (u: FakeTgUser, emoji: string) =>
      api(`/api/announcements/${announcement.id}/reactions`, {
        method: 'POST',
        user: u,
        json: { emoji },
      });
    await react(a, '🔥');
    await react(b, '🔥');
    await react(b, '🙏');
    await react(b, '🙏'); // toggled off
    expect((await react(a, '💩')).status).toBe(400);
    let feed = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, { user: a });
    expect(feed[0]!.reactions).toEqual([{ emoji: '🔥', count: 2, mine: true }]);

    await apiJson(`/api/announcements/${announcement.id}/comments`, {
      method: 'POST',
      user: a,
      json: { text: 'Я буду!' },
    });
    const list = await apiJson<CommentRow[]>(`/api/announcements/${announcement.id}/comments`, {
      method: 'POST',
      user: b,
      json: { text: 'И я' },
    });
    expect(list.map((c) => [c.author.firstName, c.text, c.mine])).toEqual([
      ['Аня', 'Я буду!', false],
      ['Борис', 'И я', true],
    ]);
    expect((await api(`/api/comments/${list[0]!.id}`, { method: 'DELETE', user: b })).status).toBe(
      403,
    );
    expect(
      (await api(`/api/comments/${list[0]!.id}`, { method: 'DELETE', user: ADMIN })).status,
    ).toBe(200);
    feed = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, { user: a });
    expect(feed[0]!.commentCount).toBe(1);

    const outsider = fakeUser('Чужак');
    expect((await react(outsider, '🔥')).status).toBe(404);
    expect(
      (await api(`/api/announcements/${announcement.id}`, { method: 'DELETE', user: a })).status,
    ).toBe(403);
    await apiJson(`/api/announcements/${announcement.id}`, { method: 'DELETE', user: ADMIN });
    feed = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, { user: a });
    expect(feed).toEqual([]);
  });

  it('counts unread posts and chat messages until the feed is opened', async () => {
    const g = await createEnv('Счётчики');
    const m = fakeUser('Счётчик');
    await join(m, g);
    const post = await apiJson<AnnouncementResult>(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'Первый', notify: false },
    });
    await apiJson(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'Второй', notify: false },
    });
    await apiJson(`/api/announcements/${post.announcement.id}/comments`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'Коммент' },
    });
    expect(await summaryFor(m, g.id)).toMatchObject({ unreadPosts: 2, unreadComments: 1 });
    await apiJson(`/api/groups/${g.id}/feed/read`, { method: 'POST', user: m });
    expect(await summaryFor(m, g.id)).toMatchObject({ unreadPosts: 0, unreadComments: 0 });
    // Own messages never count.
    await apiJson(`/api/announcements/${post.announcement.id}/comments`, {
      method: 'POST',
      user: m,
      json: { text: 'Мой' },
    });
    expect((await summaryFor(m, g.id)).unreadComments).toBe(0);
    expect((await summaryFor(ADMIN, g.id)).unreadComments).toBe(0); // admin isn't a member
  });

  it('design templates: save, use as a poster background, delete', async () => {
    const g = await createEnv('Шаблоны');
    const { id } = await apiJson<{ id: number }>('/api/templates', {
      method: 'POST',
      user: ADMIN,
      json: {
        name: 'Лого шахматкой',
        brandColor: 'night',
        pattern: { ...DEFAULT_PATTERN, layout: 'checker', kind: 'emoji', value: '🔥' },
        textColor: 'light',
      },
    });
    const list = await apiJson<DesignTemplate[]>('/api/templates', { user: ADMIN });
    expect(list.find((t) => t.id === id)).toMatchObject({ name: 'Лого шахматкой', mine: true });
    const res = await apiJson<AnnouncementResult>(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Постер', text: 'Текст', templateId: id, notify: false },
    });
    expect(res.announcement.look).toMatchObject({ brandColor: 'night', textColor: 'light' });
    expect(res.announcement.look!.pattern!.layout).toBe('checker');
    const plain = fakeUser('Без прав');
    await join(plain, g);
    expect((await api('/api/templates', { user: plain })).status).toBe(403);
    await apiJson(`/api/templates/${id}`, { method: 'DELETE', user: ADMIN });
  });
});

describe('pinned events', () => {
  it('pinned events show on everyone’s main page, even outside the ministry', async () => {
    const g = await createEnv('Закреп');
    const e = await apiJson<EventDetail>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Общецерковный пикник',
        date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
        startTime: '12:00',
        features: { rsvp: true },
      },
    });
    const outsider = fakeUser('Из другого служения');
    expect((await api(`/api/events/${e.id}`, { user: outsider })).status).toBe(404);
    await apiJson(`/api/events/${e.id}`, { method: 'PATCH', user: ADMIN, json: { pinned: true } });
    const pinned = await apiJson<EventSummary[]>('/api/events/pinned', { user: outsider });
    expect(pinned.find((x) => x.id === e.id)).toMatchObject({ pinned: true, groupName: 'Закреп' });
    const seen = await apiJson<EventDetail>(`/api/events/${e.id}`, { user: outsider });
    expect(seen).toMatchObject({ member: false, canManage: false });
    const rsvp = await api(`/api/events/${e.id}/rsvp`, {
      method: 'PUT',
      user: outsider,
      json: { status: 'going' },
    });
    expect(rsvp.status).toBe(400);
    await apiJson(`/api/events/${e.id}`, { method: 'PATCH', user: ADMIN, json: { pinned: false } });
    const after = await apiJson<EventSummary[]>('/api/events/pinned', { user: outsider });
    expect(after.map((x) => x.id)).not.toContain(e.id);
  });
});
