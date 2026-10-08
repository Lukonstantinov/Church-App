import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PATTERN,
  type AnnouncementResult,
  type AnnouncementRow,
  type CommentRow,
  type DesignTemplate,
  type PosterTemplate,
  type EventDetail,
  type EventSummary,
  type GroupDetail,
  type GroupSummary,
  type MeetingRow,
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
    expect(sent[0]!.body.photo).toEqual({ upload: true });

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

  it('counts new posts until the feed is opened, and new messages until their post is', async () => {
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
    expect(await summaryFor(m, g.id)).toMatchObject({ unreadPosts: 0, unreadComments: 1 });
    const feed = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, { user: m });
    expect(feed.find((p) => p.id === post.announcement.id)!.unreadComments).toBe(1);
    expect(feed.find((p) => p.id !== post.announcement.id)!.unreadComments).toBe(0);
    await apiJson(`/api/announcements/${post.announcement.id}/read`, { method: 'POST', user: m });
    expect(await summaryFor(m, g.id)).toMatchObject({ unreadPosts: 0, unreadComments: 0 });
    const after = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, {
      user: m,
    });
    expect(after.every((p) => p.unreadComments === 0)).toBe(true);
    // Own messages never count.
    await apiJson(`/api/announcements/${post.announcement.id}/comments`, {
      method: 'POST',
      user: m,
      json: { text: 'Мой' },
    });
    expect((await summaryFor(m, g.id)).unreadComments).toBe(0);
    expect((await summaryFor(ADMIN, g.id)).unreadComments).toBe(0); // admin isn't a member
  });

  it('posts can be edited by the author or moderators and show as edited', async () => {
    const g = await createEnv('Правки');
    const m = fakeUser('Редактор');
    await join(m, g);
    const res = await apiJson<AnnouncementResult>(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Было', text: 'Старый текст', notify: false },
    });
    const id = res.announcement.id;
    expect(res.announcement).toMatchObject({ editedAt: null, canEdit: true });
    const sent = calls.length;
    expect(
      (
        await api(`/api/announcements/${id}`, {
          method: 'PATCH',
          user: m,
          json: { text: 'Взлом' },
        })
      ).status,
    ).toBe(403);
    await apiJson(`/api/announcements/${id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { title: 'Стало', text: 'Новый текст' },
    });
    const feed = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, { user: m });
    expect(feed[0]).toMatchObject({ title: 'Стало', text: 'Новый текст', canEdit: false });
    expect(feed[0]!.editedAt).not.toBeNull();
    expect(calls.length).toBe(sent); // nobody is notified again
  });

  it('pinned posts lead the feed; only moderators pin', async () => {
    const g = await createEnv('Закрепы');
    const m = fakeUser('Смотрящий');
    await join(m, g);
    const post = (text: string) =>
      apiJson<AnnouncementResult>(`/api/groups/${g.id}/announcements`, {
        method: 'POST',
        user: ADMIN,
        json: { text, notify: false },
      });
    const old = await post('Старое важное');
    await post('Новое');
    await post('Новейшее');
    expect(
      (
        await api(`/api/announcements/${old.announcement.id}/pin`, {
          method: 'POST',
          user: m,
          json: { pinned: true },
        })
      ).status,
    ).toBe(403);
    await apiJson(`/api/announcements/${old.announcement.id}/pin`, {
      method: 'POST',
      user: ADMIN,
      json: { pinned: true },
    });
    const feed = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, { user: m });
    expect(feed.map((p) => p.text)).toEqual(['Старое важное', 'Новейшее', 'Новое']);
    expect(feed[0]).toMatchObject({ pinned: true, canPin: false });
    // Paging back never repeats the pinned post.
    const older = await apiJson<AnnouncementRow[]>(
      `/api/groups/${g.id}/announcements?before=${feed[2]!.id}`,
      { user: m },
    );
    expect(older).toEqual([]);
    await apiJson(`/api/announcements/${old.announcement.id}/pin`, {
      method: 'POST',
      user: ADMIN,
      json: { pinned: false },
    });
    const plain = await apiJson<AnnouncementRow[]>(`/api/groups/${g.id}/announcements`, {
      user: m,
    });
    expect(plain.map((p) => p.text)).toEqual(['Новейшее', 'Новое', 'Старое важное']);
  });

  it('photo background: whole card or split with the pattern; only own media', async () => {
    const g = await createEnv('Фото фон');
    const other = await createEnv('Чужое');
    const mediaId = await upload(g.id);
    const foreign = await upload(other.id);
    const backdrop = {
      mediaId,
      split: 'left',
      amount: 0.5,
      focusX: 30,
      focusY: 50,
      zoom: 1.4,
      dim: -0.3,
      soft: 0.1,
      tint: 0.4,
    };
    await apiJson(`/api/groups/${g.id}`, { method: 'PATCH', user: ADMIN, json: { backdrop } });
    const s = await summaryFor(ADMIN, g.id);
    expect(s.backdrop).toEqual(backdrop);
    // A photo saved without a tint takes the default one, so it follows the theme colour.
    const { tint: _t, ...old } = backdrop;
    await apiJson(`/api/groups/${g.id}`, { method: 'PATCH', user: ADMIN, json: { backdrop: old } });
    expect((await summaryFor(ADMIN, g.id)).backdrop?.tint).toBe(0.55);
    await apiJson(`/api/groups/${g.id}`, { method: 'PATCH', user: ADMIN, json: { backdrop } });
    expect(s.backdropUrl).toMatch(new RegExp(`^/media/m/${mediaId}\\?e=`));
    expect((await api(s.backdropUrl!)).status).toBe(200);
    const bad = await api(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { backdrop: { ...backdrop, mediaId: foreign } },
    });
    expect(bad.status).toBe(400);
    const odd = await api(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { backdrop: { ...backdrop, split: 'spiral' } },
    });
    expect(odd.status).toBe(400);
    // Posters without photos use the ministry's look, photo included.
    const res = await apiJson<AnnouncementResult>(`/api/groups/${g.id}/announcements`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'С фоном', text: 'Текст', notify: false },
    });
    expect(res.announcement.look).toMatchObject({ backdrop });
    await apiJson(`/api/groups/${g.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { backdrop: null },
    });
    expect((await summaryFor(ADMIN, g.id)).backdropUrl).toBeNull();
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

  it('poster templates: layers saved in order, used by an event, unknown pictures refused', async () => {
    const g = await createEnv('Постеры');
    const tpl = await apiJson<PosterTemplate>('/api/poster-templates', {
      method: 'POST',
      user: ADMIN,
      json: {
        name: 'Алтарь',
        background: { type: 'color', colors: ['#e8402c'] },
        layers: [
          { type: 'effect', id: 'e1', kind: 'smoke', tune: { density: 1.4 } },
          { type: 'text', id: 't1', source: 'title', size: 14, y: 40, upper: true },
          { type: 'effect', id: 'e2', kind: 'glitch' },
        ],
      },
    });
    expect(tpl.layers.map((l) => l.id)).toEqual(['e1', 't1', 'e2']);
    expect(tpl.mine).toBe(true);
    const bad = await api('/api/poster-templates', {
      method: 'POST',
      user: ADMIN,
      json: {
        name: 'Нет картинки',
        background: { type: 'color', colors: ['#000000'] },
        layers: [{ type: 'image', id: 'i1', mediaId: 999999 }],
      },
    });
    expect(bad.status).toBe(400);
    const e = await apiJson<EventDetail>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'The Altar',
        date: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10),
        startTime: '18:00',
        posterTemplateId: tpl.id,
      },
    });
    expect(e.poster).toMatchObject({ id: tpl.id, name: 'Алтарь' });
    expect(e.poster!.layers).toHaveLength(3);
    // Deleting the template takes it off the event.
    await apiJson(`/api/poster-templates/${tpl.id}`, { method: 'DELETE', user: ADMIN });
    const after = await apiJson<EventDetail>(`/api/events/${e.id}`, { user: ADMIN });
    expect(after.poster).toBeNull();
    const plain = fakeUser('Без прав постеры');
    await join(plain, g);
    expect((await api('/api/poster-templates', { user: plain })).status).toBe(403);
  });
});

describe('looks from the Design tab and profile photos', () => {
  it('meetings without a look wear the ministry default template; one meeting can differ', async () => {
    const g = await createEnv('По умолчанию');
    const { id: tplId } = await apiJson<{ id: number }>('/api/templates', {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Огонь', brandColor: 'night', pattern: null, motion: 'rays' },
    });
    const date = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    const make = (title: string) =>
      apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
        method: 'POST',
        user: ADMIN,
        json: { date, startTime: '19:00', durationMin: 120, title },
      });
    const plain = await make('Обычная');
    const own = await make('Своя');
    await apiJson(`/api/meetings/${own.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { motion: 'snow' },
    });
    await apiJson(`/api/groups/${g.id}/studio`, {
      method: 'PUT',
      user: ADMIN,
      json: { meetingTemplateId: tplId },
    });
    expect(
      (await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: ADMIN })).meetingTemplateId,
    ).toBe(tplId);
    const list = await apiJson<MeetingRow[]>(`/api/groups/${g.id}/meetings`, { user: ADMIN });
    expect(list.find((m) => m.id === plain.id)).toMatchObject({
      templateId: tplId,
      motion: 'rays',
    });
    // Its own animation wins over the template's.
    expect(list.find((m) => m.id === own.id)).toMatchObject({ motion: 'snow' });
    // The ministry's speaker-photo look reaches meetings whose template has none.
    await apiJson(`/api/groups/${g.id}/studio`, {
      method: 'PUT',
      user: ADMIN,
      json: { speakerLook: { style: 'side', x: 'right' } },
    });
    const withLook = await apiJson<MeetingRow[]>(`/api/groups/${g.id}/meetings`, { user: ADMIN });
    expect(withLook.find((m) => m.id === plain.id)!.speakerLook).toMatchObject({ style: 'side' });
    // A form sending the default template back doesn't freeze it into the meeting: when
    // the default changes, the meeting follows.
    await apiJson(`/api/meetings/${plain.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { templateId: tplId, design: { banner: true, titleSize: 'l' } },
    });
    const { id: other } = await apiJson<{ id: number }>('/api/templates', {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Другой', brandColor: 'night', pattern: null, motion: 'waves' },
    });
    await apiJson(`/api/groups/${g.id}/studio`, {
      method: 'PUT',
      user: ADMIN,
      json: { meetingTemplateId: other },
    });
    const moved = await apiJson<MeetingRow[]>(`/api/groups/${g.id}/meetings`, { user: ADMIN });
    expect(moved.find((m) => m.id === plain.id)).toMatchObject({
      templateId: other,
      motion: 'waves',
    });
    await apiJson(`/api/groups/${g.id}/studio`, {
      method: 'PUT',
      user: ADMIN,
      json: { meetingTemplateId: tplId },
    });
    // Deleting the template takes the default away.
    await apiJson(`/api/templates/${tplId}`, { method: 'DELETE', user: ADMIN });
    expect(
      (await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: ADMIN })).meetingTemplateId,
    ).toBeNull();
  });

  it('profile photo: set by the person, shown in the list and on speakers picked from people', async () => {
    const g = await createEnv('Фото');
    const person = fakeUser('Спикер Фото');
    await join(person, g);
    const row = (await apiJson<MemberRow[]>(`/api/groups/${g.id}/members`, { user: ADMIN })).find(
      (m) => m.firstName === person.first_name,
    )!;
    expect(row.photoUrl).toBeNull();
    const mediaId = await upload(g.id);
    // Someone else (not managing them) may not change it.
    const stranger = fakeUser('Чужой');
    await join(stranger, g);
    expect(
      (
        await api(`/api/users/${row.userId}/photo`, {
          method: 'PUT',
          user: stranger,
          json: { mediaId },
        })
      ).status,
    ).toBe(404);
    await apiJson(`/api/users/${row.userId}/photo`, {
      method: 'PUT',
      user: person,
      json: { mediaId },
    });
    const again = (await apiJson<MemberRow[]>(`/api/groups/${g.id}/members`, { user: ADMIN })).find(
      (m) => m.userId === row.userId,
    )!;
    expect(again.photoUrl).toMatch(/^\/media\//);
    const e = await apiJson<EventDetail>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'С гостем',
        date: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10),
        startTime: '18:00',
        speakers: [{ name: 'Спикер', userId: row.userId }],
      },
    });
    expect(e.speakers[0]).toMatchObject({ name: 'Спикер', userId: row.userId });
    expect(e.speakers[0]!.photoUrl).toMatch(/^\/media\//);
    // Someone outside the ministry can't be a picked speaker.
    const outsider = fakeUser('Снаружи');
    await sendText(outsider, '/start');
    const bad = await api(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Нет',
        date: '2030-01-01',
        startTime: '18:00',
        speakers: [{ name: 'X', userId: 999999 }],
      },
    });
    expect(bad.status).toBe(400);
  });
});

describe('event picture for the bot', () => {
  it('a cover photo goes as it is; the drawn poster only without one or with a poster template', async () => {
    const g = await createEnv('Картинка бота');
    const cover = await upload(g.id);
    const drawn = await upload(g.id);
    const e = await apiJson<EventDetail>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'С обложкой',
        date: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10),
        startTime: '18:00',
        coverMediaId: cover,
        posterMediaId: drawn,
      },
    });
    expect(e.botPictureUrl).toContain(`/${cover}?`);
    const tpl = await apiJson<PosterTemplate>('/api/poster-templates', {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Слои', background: { type: 'color', colors: ['#000000'] }, layers: [] },
    });
    const withTpl = await apiJson<EventDetail>(`/api/events/${e.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { posterTemplateId: tpl.id },
    });
    expect(withTpl.botPictureUrl).toContain(`/${drawn}?`);
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
