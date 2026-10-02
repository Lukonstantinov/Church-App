import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  addDays,
  localDate,
  DEFAULT_PATTERN,
  type ContactRow,
  type EventSummary,
  type GroupDetail,
  type MeetingDetail,
  type MeetingRow,
  type MemberRow,
  type MyAttendanceResponse,
  type RollResponse,
  type ScheduleRow,
  type TransactionPage,
} from '@church/shared';
import { getDb } from '../src/db/client';
import { eq } from 'drizzle-orm';
import { events } from '../src/db/schema';
import { remindUpcomingEvents } from '../src/jobs/tick';
import { generateMeetings } from '../src/lib/meetings';
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

const TZ = 'Europe/Riga';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (ch) => ch.charCodeAt(0),
);
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
  return row.userId;
}

const sentTo = async (chatId: number, text: string) => {
  for (let i = 0; i < 20; i++) {
    const hit = calls.find(
      (c) =>
        c.method === 'sendMessage' &&
        c.body.chat_id === chatId &&
        String(c.body.text).includes(text),
    );
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  return undefined;
};

const patch = (id: number, json: unknown, user: FakeTgUser = ADMIN) =>
  api(`/api/meetings/${id}`, { method: 'PATCH', user, json });

describe('meeting details', () => {
  it('leader and snack person get messages; the leader fills in the rest; members see only basics', async () => {
    const g = await createEnv('Встречи с ведущим');
    const lead = fakeUser('Ведущий');
    const snack = fakeUser('Перекус');
    const plain = fakeUser('Просто');
    const leadId = await join(lead, g);
    const snackId = await join(snack, g);
    await join(plain, g);
    const date = addDays(localDate(new Date(), TZ), 7);
    const meeting = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '19:00', durationMin: 120, title: 'Молодёжка' },
    });

    // Choosing the leader sends nothing; the message goes when asked, with the notes.
    expect((await patch(meeting.id, { leaderUserId: leadId })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 60));
    expect(
      calls.some((c) => c.body.chat_id === lead.id && String(c.body.text).includes('Вы ведёте')),
    ).toBe(false);
    const sent = await apiJson<{ sent: boolean }>(`/api/meetings/${meeting.id}/notify`, {
      method: 'POST',
      user: ADMIN,
      json: { role: 'leader', notes: 'Тема про веру, начни с молитвы' },
    });
    expect(sent.sent).toBe(true);
    const msg = await sentTo(lead.id, 'Вы ведёте встречу');
    expect(String(msg!.body.text)).toContain('начни с молитвы');
    const afterNotify = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, {
      user: ADMIN,
    });
    expect(afterNotify.notes).toBe('Тема про веру, начни с молитвы');
    expect(afterNotify.leaderNotifiedAt).not.toBeNull();

    // The leader may fill in place, topic, type and snacks, but not move or reassign.
    const own = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: lead });
    expect(own).toMatchObject({ canEdit: true, canManage: false, attendance: [] });
    const filled = await patch(
      meeting.id,
      { location: 'Зал 2', topic: 'Вера и дела', kind: 'worship', snackUserId: snackId },
      lead,
    );
    expect(filled.status).toBe(200);
    expect(
      (
        await api(`/api/meetings/${meeting.id}/notify`, {
          method: 'POST',
          user: lead,
          json: { role: 'snack' },
        })
      ).status,
    ).toBe(200);
    expect(await sentTo(snack.id, '15,00')).toBeDefined();
    // Only managers message the leader.
    expect(
      (
        await api(`/api/meetings/${meeting.id}/notify`, {
          method: 'POST',
          user: lead,
          json: { role: 'leader' },
        })
      ).status,
    ).toBe(403);
    expect((await patch(meeting.id, { leaderUserId: snackId }, lead)).status).toBe(403);
    expect((await patch(meeting.id, { date }, lead)).status).toBe(403);
    expect((await patch(meeting.id, { topic: 'x' }, plain)).status).toBe(403);

    const seen = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: plain });
    expect(seen).toMatchObject({
      location: 'Зал 2',
      topic: 'Вера и дела',
      kind: 'worship',
      canEdit: false,
      attendance: null,
      expenses: null,
      budgetCents: null,
    });
    expect(seen.leader).toMatchObject({ id: leadId });
    expect((await api(`/api/meetings/${meeting.id}`, { user: fakeUser('Чужой') })).status).toBe(
      404,
    );

    // An expense recorded for the meeting shows under it and filters the cash book.
    await apiJson(`/api/groups/${g.id}/transactions`, {
      method: 'POST',
      user: ADMIN,
      json: {
        kind: 'expense',
        amountCents: 1240,
        occurredOn: date,
        category: 'food',
        note: 'Пицца и сок',
        meetingId: meeting.id,
      },
    });
    const full = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: ADMIN });
    expect(full.expenses).toHaveLength(1);
    expect(full.defaultBudgetCents).toBe(1500);
    const byMeeting = await apiJson<TransactionPage>(
      `/api/groups/${g.id}/transactions?meeting=${meeting.id}`,
      { user: ADMIN },
    );
    expect(byMeeting.items).toHaveLength(1);
    expect(byMeeting.items[0]!.meeting).toMatchObject({ id: meeting.id, title: 'Молодёжка' });
    const byText = await apiJson<TransactionPage>(
      `/api/groups/${g.id}/transactions?q=${encodeURIComponent('пицца')}&all=1`,
      { user: ADMIN },
    );
    expect(byText.items).toHaveLength(1);
  });

  it('a moved meeting keeps its schedule slot, so it is not created again', async () => {
    const g = await createEnv('Перенос');
    const schedule = await apiJson<ScheduleRow>(`/api/groups/${g.id}/schedules`, {
      method: 'POST',
      user: ADMIN,
      json: { weekday: 2, startTime: '19:00', durationMin: 120, title: 'Среда' },
    });
    await env.DB.prepare(
      "UPDATE meeting_schedules SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind(schedule.id)
      .run();
    const db = getDb(env.DB);
    await generateMeetings(db, TZ, { groupId: g.id });
    const before = await apiJson<MeetingRow[]>(`/api/groups/${g.id}/meetings?limit=100`, {
      user: ADMIN,
    });
    expect(before.length).toBeGreaterThanOrEqual(12); // about three months ahead
    const first = before[0]!;
    const moved = addDays(localDate(first.startsAt, TZ), 1);
    expect((await patch(first.id, { date: moved, startTime: '18:30' })).status).toBe(200);
    await generateMeetings(db, TZ, { groupId: g.id });
    const after = await apiJson<MeetingRow[]>(`/api/groups/${g.id}/meetings?limit=100`, {
      user: ADMIN,
    });
    expect(after).toHaveLength(before.length);
    const again = after.find((m) => m.id === first.id)!;
    expect(localDate(again.startsAt, TZ)).toBe(moved);
  });
});

describe('contacts and event covers', () => {
  it('members see each other with positions; event covers carry a design', async () => {
    const g = await createEnv('Контакты');
    const m = fakeUser('Контакт');
    await join(m, g);
    const list = await apiJson<ContactRow[]>(`/api/groups/${g.id}/contacts`, { user: m });
    expect(list.find((c) => c.firstName === 'Контакт')).toMatchObject({ offline: false });
    expect(list.every((c) => 'positionName' in c)).toBe(true);
    expect(
      (await api(`/api/groups/${g.id}/contacts`, { user: fakeUser('Посторонний') })).status,
    ).toBe(404);

    const date = addDays(localDate(new Date(), TZ), 5);
    const created = await apiJson<EventSummary>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Пикник',
        date,
        startTime: '12:00',
        design: {
          banner: true,
          brandColor: 'forest',
          titleFont: 'pacifico',
          custom: {
            pattern: { ...DEFAULT_PATTERN, value: '🌳' },
            backdrop: null,
            textColor: 'light',
          },
        },
      },
    });
    const list2 = await apiJson<EventSummary[]>(`/api/groups/${g.id}/events?scope=upcoming`, {
      user: m,
    });
    const e = list2.find((x) => x.id === created.id)!;
    expect(e.design).toMatchObject({ banner: true, titleFont: 'pacifico' });
    expect(e.look).toMatchObject({ brandColor: 'forest', textColor: 'light' });
    expect(e.look!.pattern!.value).toBe('🌳');
  });
});

describe('meetings for chosen people', () => {
  it('only the chosen see the meeting and are on its roll call', async () => {
    const g = await createEnv('Только для своих');
    const inv = fakeUser('Приглашённый');
    const out = fakeUser('Невидимый');
    const invId = await join(inv, g);
    await join(out, g);
    const date = addDays(localDate(new Date(), TZ), 1);
    const m = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '18:00', title: 'Команда', audience: [invId] },
    });
    expect(m.audience).toEqual([invId]);
    expect((await api(`/api/meetings/${m.id}`, { user: inv })).status).toBe(200);
    expect((await api(`/api/meetings/${m.id}`, { user: out })).status).toBe(404);

    const mine = async (u: FakeTgUser) =>
      (await apiJson<MyAttendanceResponse>('/api/me/attendance', { user: u })).groups.find(
        (x) => x.groupId === g.id,
      )!.nextMeeting;
    expect((await mine(inv))?.id).toBe(m.id);
    expect(await mine(out)).toBeNull();

    // Roll call: only the chosen person (the meeting is tomorrow, so move it to now).
    await env.DB.prepare('UPDATE meetings SET starts_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 600_000).toISOString(), m.id)
      .run();
    const roll = await apiJson<RollResponse>(`/api/meetings/${m.id}/roll`, { user: ADMIN });
    expect(roll.roster.map((r) => r.userId)).toEqual([invId]);

    // Back to everyone.
    await apiJson(`/api/meetings/${m.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { audience: null },
    });
    expect((await api(`/api/meetings/${m.id}`, { user: out })).status).toBe(200);
    const outsider = fakeUser('Не в служении');
    expect(
      (
        await api(`/api/groups/${g.id}/meetings`, {
          method: 'POST',
          user: ADMIN,
          json: { date, startTime: '18:00', title: 'x', audience: [99999] },
        })
      ).status,
    ).toBe(400);
    void outsider;
  });
});

describe('message preview, answers and the calendar', () => {
  it('the leader reads and changes the text, then agrees or declines with a button', async () => {
    const g = await createEnv('Сообщение ведущему');
    const lead = fakeUser('Лидер');
    const other = fakeUser('Другой');
    const leadId = await join(lead, g);
    await join(other, g);
    const date = addDays(localDate(new Date(), TZ), 5);
    const meeting = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '19:00', durationMin: 120, title: 'Молодёжка' },
    });
    await patch(meeting.id, { leaderUserId: leadId });

    // The default text, with the notes, to read and change before sending.
    const preview = await apiJson<{ text: string }>(
      `/api/meetings/${meeting.id}/notify-text?role=leader&notes=${encodeURIComponent('Возьми гитару')}`,
      { user: ADMIN },
    );
    expect(preview.text).toContain('Вы ведёте встречу');
    expect(preview.text).toContain('Возьми гитару');
    expect(preview.text).not.toContain('<b>');

    const photo = (
      (await (
        await api(`/api/groups/${g.id}/media?kind=event`, {
          method: 'POST',
          user: ADMIN,
          body: PNG,
        })
      ).json()) as { id: number }
    ).id;
    const res = await apiJson<{ sent: boolean }>(`/api/meetings/${meeting.id}/notify`, {
      method: 'POST',
      user: ADMIN,
      json: { role: 'leader', text: 'Привет, <друг>!\nВедёшь в пятницу.', posterMediaId: photo },
    });
    expect(res.sent).toBe(true);
    const msg = await sentTo(lead.id, 'Ведёшь в пятницу');
    expect(String(msg!.body.text)).toContain('<b>Привет, &lt;друг&gt;!</b>');
    expect(JSON.stringify(msg!.body.reply_markup)).toContain(`ma:y:${meeting.id}:l`);
    expect(
      calls.some(
        (c) =>
          c.method === 'sendPhoto' &&
          c.body.chat_id === lead.id &&
          String(c.body.photo).includes(`/media/m/${photo}`),
      ),
    ).toBe(true);

    // Someone else's button does nothing; the leader agrees and the sender hears of it.
    await pressButton(other, `ma:y:${meeting.id}:l`);
    expect(
      (await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: ADMIN }))
        .leaderAcceptedAt,
    ).toBeNull();
    await pressButton(lead, `ma:y:${meeting.id}:l`);
    expect(
      (await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: ADMIN }))
        .leaderAcceptedAt,
    ).not.toBeNull();
    expect(await sentTo(ADMIN.id, 'Лидер подтвердил(а)')).toBeDefined();

    // "Can't" frees the place, and the sender is told to choose someone else.
    await apiJson(`/api/meetings/${meeting.id}/notify`, {
      method: 'POST',
      user: ADMIN,
      json: { role: 'leader' },
    });
    await pressButton(lead, `ma:n:${meeting.id}:l`);
    const freed = await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: ADMIN });
    expect(freed.leader).toBeNull();
    expect(freed.leaderNotifiedAt).toBeNull();
    expect(await sentTo(ADMIN.id, 'Лидер не может')).toBeDefined();
  });

  it('everyone sees meetings and events; only leaders write and see notes', async () => {
    const g = await createEnv('Календарь');
    const member = fakeUser('Участник');
    await join(member, g);
    const date = addDays(localDate(new Date(), TZ), 3);
    await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '19:00', durationMin: 120, title: 'Молодёжка' },
    });
    await apiJson(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Лагерь', date: addDays(date, 10), startTime: '10:00', countdown: true },
    });

    const note = await api(`/api/groups/${g.id}/calendar-notes`, {
      method: 'POST',
      user: ADMIN,
      json: { date, text: 'Купить свечи', color: '#22c55e' },
    });
    expect(note.status).toBe(201);
    const { id: noteId } = (await note.json()) as { id: number };
    expect(
      (
        await api(`/api/groups/${g.id}/calendar-notes`, {
          method: 'POST',
          user: member,
          json: { date, text: 'x', color: '#22c55e' },
        })
      ).status,
    ).toBe(403);

    type Cal = {
      meetings: MeetingRow[];
      events: EventSummary[];
      notes: unknown[] | null;
      canNote: boolean;
    };
    const lead = await apiJson<Cal>(`/api/groups/${g.id}/calendar`, { user: ADMIN });
    expect(lead.canNote).toBe(true);
    expect(lead.notes).toEqual([{ id: noteId, date, text: 'Купить свечи', color: '#22c55e' }]);
    const seen = await apiJson<Cal>(`/api/groups/${g.id}/calendar`, { user: member });
    expect(seen).toMatchObject({ canNote: false, notes: null });
    expect(seen.meetings.map((m) => m.title)).toEqual(['Молодёжка']);
    expect(seen.events[0]).toMatchObject({ title: 'Лагерь', countdown: true });

    expect(
      (
        await api(`/api/calendar-notes/${noteId}`, {
          method: 'PATCH',
          user: ADMIN,
          json: { date, text: 'Купить свечи и чай', color: '#6366f1' },
        })
      ).status,
    ).toBe(200);
    expect(
      (await api(`/api/calendar-notes/${noteId}`, { method: 'DELETE', user: member })).status,
    ).toBe(404);
    expect(
      (await api(`/api/calendar-notes/${noteId}`, { method: 'DELETE', user: ADMIN })).status,
    ).toBe(200);
    expect((await apiJson<Cal>(`/api/groups/${g.id}/calendar`, { user: ADMIN })).notes).toEqual([]);
  });
});

describe('assigned jobs window', () => {
  it('lists what the person must fill in; answering keeps the way into the meeting', async () => {
    const g = await createEnv('Мои назначения');
    const lead = fakeUser('Назначенный');
    const snack = fakeUser('Перекусный');
    const leadId = await join(lead, g);
    const snackId = await join(snack, g);
    const date = addDays(localDate(new Date(), TZ), 4);
    const meeting = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '19:00', durationMin: 120, title: 'Вечер' },
    });
    await patch(meeting.id, { leaderUserId: leadId, snackUserId: snackId });

    type Job = {
      meetingId: number;
      role: string;
      missing: string[];
      acceptedAt: string | null;
      budgetCents: number;
    };
    const mine = await apiJson<Job[]>('/api/me/assignments', { user: lead });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      meetingId: meeting.id,
      role: 'leader',
      missing: ['location', 'topic'],
      acceptedAt: null,
    });
    const theirs = await apiJson<Job[]>('/api/me/assignments', { user: snack });
    expect(theirs[0]).toMatchObject({ role: 'snack', missing: [], budgetCents: 1500 });
    expect(await apiJson<Job[]>('/api/me/assignments', { user: fakeUser('Никто') })).toEqual([]);

    // Once filled in, nothing is missing.
    await patch(meeting.id, { location: 'Зал', topic: 'Вера' }, lead);
    expect((await apiJson<Job[]>('/api/me/assignments', { user: lead }))[0]!.missing).toEqual([]);

    // The meeting says what the viewer has to answer.
    expect(
      await apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user: lead }),
    ).toMatchObject({ myRole: 'leader', myAcceptedAt: null });

    // Agree in the app (someone else can't answer for them).
    expect(
      (
        await api(`/api/meetings/${meeting.id}/answer`, {
          method: 'POST',
          user: snack,
          json: { role: 'leader', agree: true },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/api/meetings/${meeting.id}/answer`, {
          method: 'POST',
          user: lead,
          json: { role: 'leader', agree: true },
        })
      ).status,
    ).toBe(200);
    expect(
      (await apiJson<Job[]>('/api/me/assignments', { user: lead }))[0]!.acceptedAt,
    ).not.toBeNull();

    // In the bot: agreeing leaves "Open meeting" under the message and in the reply.
    await apiJson(`/api/meetings/${meeting.id}/notify`, {
      method: 'POST',
      user: ADMIN,
      json: { role: 'snack' },
    });
    calls.length = 0;
    await pressButton(snack, `ma:y:${meeting.id}:s`);
    const kept = calls.find((c) => c.method === 'editMessageReplyMarkup');
    expect(JSON.stringify(kept?.body.reply_markup)).toContain(`?meeting=${meeting.id}`);
    const reply = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === snack.id);
    expect(JSON.stringify(reply?.body.reply_markup)).toContain(`?meeting=${meeting.id}`);

    // "Can't" removes the buttons, frees the job and it leaves their list.
    await pressButton(lead, `ma:n:${meeting.id}:l`);
    expect(await apiJson<Job[]>('/api/me/assignments', { user: lead })).toEqual([]);
  });
});

describe('message templates', () => {
  it('saves only the wording: this meeting’s values become placeholders for the next one', async () => {
    const g = await createEnv('Шаблоны сообщений');
    const lead = fakeUser('Ведущая');
    const leadId = await join(lead, g);
    const d1 = addDays(localDate(new Date(), TZ), 3);
    const d2 = addDays(localDate(new Date(), TZ), 9);
    const make = (date: string, title: string) =>
      apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
        method: 'POST',
        user: ADMIN,
        json: { date, startTime: '19:00', durationMin: 120, title },
      });
    const m1 = await make(d1, 'Молодёжка');
    const m2 = await make(d2, 'Вечер хвалы');
    await patch(m1.id, { leaderUserId: leadId });
    await patch(m2.id, { leaderUserId: leadId });

    // The text the sender sees for meeting 1, with their own wording added.
    const shown = (
      await apiJson<{ text: string }>(`/api/meetings/${m1.id}/notify-text?role=leader`, {
        user: ADMIN,
      })
    ).text;
    const edited = `Привет, Ведущая! Ждём тебя на «Молодёжка» — ${shown.split('\n')[2]}. Бюджет ${/бюджет (.+?)\)/.exec(shown)![1]}`;
    const saved = await apiJson<{ id: number; text: string }>(
      `/api/meetings/${m1.id}/message-templates`,
      { method: 'POST', user: ADMIN, json: { role: 'leader', name: 'Тёплое', text: edited } },
    );
    expect(saved.text).toContain('{name}');
    expect(saved.text).toContain('«{title}»');
    expect(saved.text).toContain('{date}');
    expect(saved.text).toContain('{budget}');
    expect(saved.text).not.toContain('Молодёжка');

    // Used on another meeting it fills in that meeting's values (and its notes at the end).
    const filled = (
      await apiJson<{ text: string }>(
        `/api/meetings/${m2.id}/notify-text?role=leader&template=${saved.id}&notes=${encodeURIComponent('Гитара')}`,
        { user: ADMIN },
      )
    ).text;
    expect(filled).toContain('Привет, Ведущая!');
    expect(filled).toContain('«Вечер хвалы»');
    expect(filled).not.toContain('{');
    expect(filled.endsWith('📝 Гитара')).toBe(true);

    // Listed for the ministry; the one who saved it or a manager may delete it.
    const list = await apiJson<{ id: number; canDelete: boolean }[]>(
      `/api/meetings/${m2.id}/message-templates`,
      { user: lead },
    );
    expect(list).toEqual([expect.objectContaining({ id: saved.id, canDelete: false })]);
    expect(
      (await api(`/api/message-templates/${saved.id}`, { method: 'DELETE', user: lead })).status,
    ).toBe(403);
    expect(
      (await api(`/api/message-templates/${saved.id}`, { method: 'DELETE', user: ADMIN })).status,
    ).toBe(200);
    expect(
      await apiJson<unknown[]>(`/api/meetings/${m2.id}/message-templates`, { user: ADMIN }),
    ).toEqual([]);
  });
});

describe('default meeting place', () => {
  it('is Šeškinės 22A, shown on the meeting, and changeable in the ministry settings', async () => {
    const g = await createEnv('Место по умолчанию');
    const date = addDays(localDate(new Date(), TZ), 5);
    const meeting = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '19:00', durationMin: 120, title: 'Вечер' },
    });
    const seen = (user = ADMIN) => apiJson<MeetingDetail>(`/api/meetings/${meeting.id}`, { user });
    expect(await seen()).toMatchObject({ defaultLocation: 'Šeškinės 22A', location: null });
    expect(
      (
        await api(`/api/groups/${g.id}`, {
          method: 'PATCH',
          user: ADMIN,
          json: { defaultLocation: 'Зал церкви' },
        })
      ).status,
    ).toBe(200);
    expect((await seen()).defaultLocation).toBe('Зал церкви');
    expect(
      (await apiJson<GroupDetail>(`/api/groups/${g.id}`, { user: ADMIN })).defaultLocation,
    ).toBe('Зал церкви');
  });
});

describe('event reminders and the sender line', () => {
  it('leaders remind everyone or chosen people; the message says who sent it', async () => {
    const g = await createEnv('Напоминания');
    const a = fakeUser('Первый');
    const b = fakeUser('Второй');
    await join(a, g);
    const bId = await join(b, g);
    const date = addDays(localDate(new Date(), TZ), 5);
    const event = await apiJson<EventSummary>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Лагерь', date, startTime: '10:00', location: 'Лес' },
    });

    const def = await apiJson<{ text: string }>(`/api/events/${event.id}/reminder-text`, {
      user: ADMIN,
    });
    expect(def.text).toContain('Лагерь');
    expect(def.text).not.toContain('<b>');

    // Members can't send reminders.
    expect(
      (await api(`/api/events/${event.id}/remind`, { method: 'POST', user: a, json: {} })).status,
    ).toBe(403);

    // To chosen people only: the signature and the way to the event are there.
    calls.length = 0;
    const some = await apiJson<{ sent: number }>(`/api/events/${event.id}/remind`, {
      method: 'POST',
      user: ADMIN,
      json: { text: 'Не забудьте про лагерь!\nВозьмите куртки', userIds: [bId] },
    });
    expect(some.sent).toBe(1);
    const msg = await sentTo(b.id, 'Не забудьте про лагерь');
    expect(String(msg!.body.text)).toContain('<b>Не забудьте про лагерь!</b>');
    expect(String(msg!.body.text)).toContain('Отправил(а):');
    expect(JSON.stringify(msg!.body.reply_markup)).toContain(`?event=${event.id}`);
    expect(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === a.id)).toBe(false);

    // To everyone with the default text.
    const all = await apiJson<{ sent: number }>(`/api/events/${event.id}/remind`, {
      method: 'POST',
      user: ADMIN,
      json: {},
    });
    expect(all.sent).toBeGreaterThanOrEqual(2);
    expect(await sentTo(a.id, 'Напоминание')).toBeDefined();
  });

  it('the meeting message to the leader also carries "Отправил(а)"', async () => {
    const g = await createEnv('Подпись');
    const lead = fakeUser('Подписанный');
    const leadId = await join(lead, g);
    const date = addDays(localDate(new Date(), TZ), 4);
    const m = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date, startTime: '19:00', durationMin: 120, title: 'Вечер' },
    });
    await patch(m.id, { leaderUserId: leadId });
    await api(`/api/meetings/${m.id}/notify`, {
      method: 'POST',
      user: ADMIN,
      json: { role: 'leader' },
    });
    expect(String((await sentTo(lead.id, 'Вы ведёте встречу'))!.body.text)).toContain(
      'Отправил(а): Админ',
    );
  });

  it('the group rule reminds once, ahead of an event that is not brand new', async () => {
    const g = await createEnv('Автонапоминание');
    const a = fakeUser('Автополучатель');
    await join(a, g);
    expect(
      (
        await api(`/api/groups/${g.id}`, {
          method: 'PATCH',
          user: ADMIN,
          json: { eventReminderHours: 48 },
        })
      ).status,
    ).toBe(200);
    const date = addDays(localDate(new Date(), TZ), 1);
    const event = await apiJson<EventSummary>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Завтрашнее', date, startTime: '23:00' },
    });
    const db = getDb(env.DB);
    // Brand new: left alone this hour.
    await remindUpcomingEvents(db, env as never, new Date());
    expect(
      calls.some((c) => c.body.chat_id === a.id && String(c.body.text).includes('Завтрашнее')),
    ).toBe(false);
    await db
      .update(events)
      .set({ createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() })
      .where(eq(events.id, event.id));
    await remindUpcomingEvents(db, env as never, new Date());
    await remindUpcomingEvents(db, env as never, new Date());
    await drainOutbox(db, botApi(env as never), { limit: 100 });
    const hits = calls.filter(
      (c) =>
        c.method === 'sendMessage' &&
        c.body.chat_id === a.id &&
        String(c.body.text).includes('Завтрашнее'),
    );
    expect(hits).toHaveLength(1);
    expect(String(hits[0]!.body.text)).not.toContain('Отправил(а)');
  });
});

describe('event duties', () => {
  it('describes each duty and tells only the newly assigned people', async () => {
    const g = await createEnv('Служения на событии');
    const a = fakeUser('Техник');
    const b = fakeUser('Уборщик');
    const aId = await join(a, g);
    const bId = await join(b, g);
    const date = addDays(localDate(new Date(), TZ), 6);
    const ev = await apiJson<EventSummary>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Конференция',
        date,
        startTime: '10:00',
        location: 'Вильнюс',
        description: 'Большой день для всей молодёжи.\n\nПрограмма внутри.',
        roles: [{ name: 'Техника', description: 'Свет и звук, приходить за час', userIds: [aId] }],
        notifyAssigned: true,
      },
    });
    const first = await sentTo(a.id, 'Вам назначено служение');
    expect(String(first!.body.text)).toContain('Техника');
    expect(String(first!.body.text)).toContain('Свет и звук, приходить за час');
    expect(String(first!.body.text)).toContain('Отправил(а):');
    expect(JSON.stringify(first!.body.reply_markup)).toContain(`?event=${ev.id}`);

    const detail = await apiJson<{
      description: string;
      roles: { id: number; description: string }[];
    }>(`/api/events/${ev.id}`, { user: a });
    expect(detail.description).toContain('Программа внутри');
    expect(detail.roles[0]!.description).toBe('Свет и звук, приходить за час');

    // Editing: the first person is not told again, the new one is; no flag, nobody is told.
    calls.length = 0;
    const roleId = detail.roles[0]!.id;
    await apiJson(`/api/events/${ev.id}/roles`, {
      method: 'PUT',
      user: ADMIN,
      json: {
        roles: [{ id: roleId, name: 'Техника', description: 'Свет и звук', userIds: [aId, bId] }],
        notify: true,
      },
    });
    expect(await sentTo(b.id, 'Вам назначено служение')).toBeDefined();
    expect(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === a.id)).toBe(false);
    calls.length = 0;
    await apiJson(`/api/events/${ev.id}/roles`, {
      method: 'PUT',
      user: ADMIN,
      json: { roles: [{ id: roleId, name: 'Техника', userIds: [aId] }] },
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.some((c) => c.method === 'sendMessage')).toBe(false);
  });
});

describe('sending a post again', () => {
  it('goes to everyone or chosen people, marked as a repeat with who sent it', async () => {
    const g = await createEnv('Повтор поста');
    const a = fakeUser('Читатель');
    const b = fakeUser('Второй читатель');
    await join(a, g);
    const bId = await join(b, g);
    const post = await apiJson<{ announcement: { id: number } }>(
      `/api/groups/${g.id}/announcements`,
      { method: 'POST', user: ADMIN, json: { text: 'Собрание в пятницу', notify: false } },
    );
    const id = post.announcement.id;
    calls.length = 0;
    expect(
      (await api(`/api/announcements/${id}/resend`, { method: 'POST', user: a, json: {} })).status,
    ).toBe(403);

    const some = await apiJson<{ sent: number }>(`/api/announcements/${id}/resend`, {
      method: 'POST',
      user: ADMIN,
      json: { userIds: [bId] },
    });
    expect(some.sent).toBe(1);
    const msg = await sentTo(b.id, 'Собрание в пятницу');
    expect(String(msg!.body.text)).toContain('Напоминание о публикации');
    expect(String(msg!.body.text)).toContain('Отправил(а):');
    expect(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === a.id)).toBe(false);

    const all = await apiJson<{ sent: number }>(`/api/announcements/${id}/resend`, {
      method: 'POST',
      user: ADMIN,
      json: {},
    });
    expect(all.sent).toBeGreaterThanOrEqual(2);
    expect(await sentTo(a.id, 'Собрание в пятницу')).toBeDefined();
  });
});

describe('labels', () => {
  it('a ministry makes labels with a colour and animation and gives them to people', async () => {
    const g = await createEnv('Метки людей');
    const a = fakeUser('Меченый');
    const aId = await join(a, g);
    type Label = { id: number; name: string; color: string; animation: string };
    const label = await apiJson<Label>(`/api/groups/${g.id}/labels`, {
      method: 'POST',
      user: ADMIN,
      json: { name: 'Прославление', color: '#A855F7', animation: 'shimmer' },
    });
    expect(label).toMatchObject({ name: 'Прославление', color: '#a855f7', animation: 'shimmer' });
    // Members can't create labels.
    expect(
      (
        await api(`/api/groups/${g.id}/labels`, {
          method: 'POST',
          user: a,
          json: { name: 'x', color: '#000000' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/api/groups/${g.id}/labels`, {
          method: 'POST',
          user: ADMIN,
          json: { name: 'x', color: 'red', animation: 'shimmer' },
        })
      ).status,
    ).toBe(400);

    const give = (ids: number[]) =>
      api(`/api/groups/${g.id}/members/${aId}/labels`, {
        method: 'PUT',
        user: ADMIN,
        json: { labelIds: ids },
      });
    expect((await give([label.id])).status).toBe(200);
    const row = async () =>
      (await apiJson<MemberRow[]>(`/api/groups/${g.id}/members`, { user: ADMIN })).find(
        (m) => m.userId === aId,
      )!;
    expect((await row()).labels).toEqual([label]);
    expect((await give([99999])).status).toBe(400);

    await apiJson(`/api/labels/${label.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { name: 'Команда', color: '#22c55e', animation: 'glow' },
    });
    expect((await row()).labels[0]).toMatchObject({ name: 'Команда', animation: 'glow' });
    expect((await api(`/api/labels/${label.id}`, { method: 'DELETE', user: a })).status).toBe(403);
    expect((await api(`/api/labels/${label.id}`, { method: 'DELETE', user: ADMIN })).status).toBe(
      200,
    );
    expect((await row()).labels).toEqual([]);
  });
});

describe('telling people about their duties', () => {
  it('reports the result and can write to people already assigned', async () => {
    const g = await createEnv('Сообщить о служении');
    const a = fakeUser('Назначенный');
    const aId = await join(a, g);
    const date = addDays(localDate(new Date(), TZ), 6);
    const ev = await apiJson<{ id: number; roles: { id: number }[] }>(
      `/api/groups/${g.id}/events`,
      {
        method: 'POST',
        user: ADMIN,
        json: {
          title: 'Выезд',
          date,
          startTime: '10:00',
          features: { duties: true },
          roles: [{ name: 'Звук', description: 'Принести кабели' }],
        },
      },
    );
    const roleId = (
      await apiJson<{ roles: { id: number }[] }>(`/api/events/${ev.id}`, { user: ADMIN })
    ).roles[0]!.id;

    // Assigned without a message (switch off): nothing is sent, and nothing is reported.
    calls.length = 0;
    const quiet = await apiJson<{ notified: unknown }>(`/api/events/${ev.id}/roles`, {
      method: 'PUT',
      user: ADMIN,
      json: {
        roles: [{ id: roleId, name: 'Звук', description: 'Принести кабели', userIds: [aId] }],
      },
    });
    expect(quiet.notified).toBeNull();
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === a.id)).toBe(false);

    // Saving again with the switch on: nobody is new, so the count is 0 — but "tell them now" works.
    const again = await apiJson<{ notified: { sent: number; skipped: string[] } }>(
      `/api/events/${ev.id}/roles`,
      {
        method: 'PUT',
        user: ADMIN,
        json: {
          roles: [{ id: roleId, name: 'Звук', description: 'Принести кабели', userIds: [aId] }],
          notify: true,
        },
      },
    );
    expect(again.notified).toEqual({ sent: 0, skipped: [] });
    expect(
      (await api(`/api/events/${ev.id}/duties/notify`, { method: 'POST', user: a, json: {} }))
        .status,
    ).toBe(403);
    const now = await apiJson<{ sent: number; skipped: string[] }>(
      `/api/events/${ev.id}/duties/notify`,
      { method: 'POST', user: ADMIN, json: { roleId } },
    );
    expect(now).toEqual({ sent: 1, skipped: [] });
    expect(String((await sentTo(a.id, 'Вам назначено служение'))!.body.text)).toContain(
      'Принести кабели',
    );
  });
});

describe('notification inbox', () => {
  it('keeps what people were told, opens its page and can be marked read', async () => {
    const g = await createEnv('Уведомления');
    const a = fakeUser('Получатель');
    const aId = await join(a, g);
    const date = addDays(localDate(new Date(), TZ), 5);
    const ev = await apiJson<{ id: number }>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Лагерь',
        date,
        startTime: '10:00',
        description: 'Берите тёплые вещи и спальник.',
        features: { duties: true },
        roles: [{ name: 'Кухня', userIds: [aId] }],
      },
    });
    type Inbox = {
      unread: number;
      items: {
        id: number;
        kind: string;
        title: string;
        body: string;
        read: boolean;
        link: unknown;
      }[];
    };
    expect((await apiJson<Inbox>('/api/me/notifications', { user: a })).items).toEqual([]);

    await apiJson(`/api/events/${ev.id}/remind`, { method: 'POST', user: ADMIN, json: {} });
    const box = await apiJson<Inbox>('/api/me/notifications', { user: a });
    expect(box.unread).toBe(1);
    expect(box.items[0]).toMatchObject({
      kind: 'event_reminder',
      read: false,
      link: { type: 'event', eventId: ev.id },
    });
    expect(box.items[0]!.title).toContain('Лагерь');
    // The default reminder carries the description and the person's own duty.
    expect(box.items[0]!.body).toContain('спальник');
    expect(box.items[0]!.body).toContain('Кухня');
    const msg = await sentTo(a.id, 'Напоминание');
    expect(String(msg!.body.text)).toContain('Кухня');

    // Someone else's inbox is separate; reading clears the counter.
    expect((await apiJson<Inbox>('/api/me/notifications', { user: ADMIN })).unread).toBe(0);
    await apiJson('/api/me/notifications/read', { method: 'POST', user: a, json: {} });
    const after = await apiJson<Inbox>('/api/me/notifications', { user: a });
    expect(after.unread).toBe(0);
    expect(after.items[0]!.read).toBe(true);
  });
});

describe('event programme', () => {
  it('managers set a timed programme with leaders; everyone reads it in order', async () => {
    const g = await createEnv('Программа события');
    const a = fakeUser('Ведущий программы');
    const aId = await join(a, g);
    const date = addDays(localDate(new Date(), TZ), 6);
    const ev = await apiJson<{ id: number }>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: { title: 'Конференция', date, startTime: '10:00' },
    });
    type Item = {
      time: string;
      title: string;
      day: number;
      person: { id: number } | null;
      note: string | null;
    };
    const put = (user: FakeTgUser, items: unknown[]) =>
      api(`/api/events/${ev.id}/program`, { method: 'PUT', user, json: { items } });

    expect((await put(a, [])).status).toBe(403);
    expect((await put(ADMIN, [{ time: '12:00', title: 'Обед', userId: 999999 }])).status).toBe(400);
    expect(
      (
        await put(ADMIN, [
          { time: '14:00', title: 'Прославление', userId: aId, note: 'Две песни' },
          { time: '10:30', title: 'Регистрация' },
          { time: '09:00', day: 1, title: 'Завтрак' },
        ])
      ).status,
    ).toBe(200);
    const seen = (await apiJson<{ program: Item[] }>(`/api/events/${ev.id}`, { user: a })).program;
    expect(seen.map((i) => `${i.day}:${i.time}`)).toEqual(['0:10:30', '0:14:00', '1:09:00']);
    expect(seen[1]).toMatchObject({
      title: 'Прославление',
      person: { id: aId },
      note: 'Две песни',
    });

    // Saving replaces the whole list.
    await put(ADMIN, [{ time: '11:00', title: 'Единственный пункт' }]);
    expect(
      (await apiJson<{ program: Item[] }>(`/api/events/${ev.id}`, { user: a })).program,
    ).toHaveLength(1);
  });
});

describe('duty leaders and the poster label', () => {
  it('marks one assignee as the duty leader; admins set the label printed on posters', async () => {
    const g = await createEnv('Лидеры служений');
    const a = fakeUser('Первый лидер');
    const b = fakeUser('Второй');
    const aId = await join(a, g);
    const bId = await join(b, g);
    const date = addDays(localDate(new Date(), TZ), 6);
    const ev = await apiJson<{ id: number }>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Выезд',
        date,
        startTime: '10:00',
        features: { duties: true },
        roles: [{ name: 'Звук' }],
      },
    });
    type Detail = { roles: { id: number; leader: { id: number } | null }[] };
    const roleId = (await apiJson<Detail>(`/api/events/${ev.id}`, { user: ADMIN })).roles[0]!.id;
    const put = (leaderId: number | null, userIds: number[]) =>
      apiJson(`/api/events/${ev.id}/roles`, {
        method: 'PUT',
        user: ADMIN,
        json: { roles: [{ id: roleId, name: 'Звук', userIds, leaderId }] },
      });
    await put(bId, [aId, bId]);
    expect(
      (await apiJson<Detail>(`/api/events/${ev.id}`, { user: a })).roles[0]!.leader,
    ).toMatchObject({ id: bId });
    // A leader who isn't among the people is ignored.
    await put(999, [aId]);
    expect(
      (await apiJson<Detail>(`/api/events/${ev.id}`, { user: a })).roles[0]!.leader,
    ).toBeNull();

    // The label on posters: admin only, empty falls back to the church name.
    expect(
      (await api('/api/church', { method: 'PATCH', user: a, json: { sheetLabel: 'CZK Church' } }))
        .status,
    ).toBe(403);
    const church = await apiJson<{ sheetLabel: string | null }>('/api/church', {
      method: 'PATCH',
      user: ADMIN,
      json: { sheetLabel: 'CZK Church' },
    });
    expect(church.sheetLabel).toBe('CZK Church');
    expect(
      (
        await apiJson<{ sheetLabel: string | null }>('/api/church', {
          method: 'PATCH',
          user: ADMIN,
          json: { sheetLabel: null },
        })
      ).sheetLabel,
    ).toBeNull();
  });
});

describe('personal bot commands', () => {
  it('/services lists my ministries, duties and jobs; /events the nearest; /schedule by period', async () => {
    const g = await createEnv('Команды бота');
    const me = fakeUser('Командир');
    const meId = await join(me, g);
    const d1 = addDays(localDate(new Date(), TZ), 3);
    const d2 = addDays(localDate(new Date(), TZ), 40);
    const meeting = await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date: d1, startTime: '19:00', durationMin: 120, title: 'Вечер молодёжи' },
    });
    await patch(meeting.id, { leaderUserId: meId });
    await apiJson<MeetingRow>(`/api/groups/${g.id}/meetings`, {
      method: 'POST',
      user: ADMIN,
      json: { date: d2, startTime: '19:00', durationMin: 120, title: 'Далёкая встреча' },
    });
    await apiJson(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Лагерь осени',
        date: addDays(localDate(new Date(), TZ), 10),
        startTime: '10:00',
        location: 'Лес',
        features: { duties: true },
        roles: [{ name: 'Кухня', userIds: [meId] }],
      },
    });

    calls.length = 0;
    await sendText(me, '/services');
    const services = String((await sentTo(me.id, 'Ваши служения'))!.body.text);
    expect(services).toContain('Команды бота');
    expect(services).toContain('Кухня');
    expect(services).toContain('Вечер молодёжи');
    expect(services).toContain('ведёте');

    calls.length = 0;
    await sendText(me, '/events');
    expect(await sentTo(me.id, 'Ближайшие события')).toBeTruthy();
    // Each event is its own card: where, who is responsible for what, and my duty.
    const card = String((await sentTo(me.id, 'Лагерь осени'))!.body.text);
    expect(card).toContain('Лес');
    expect(card).toContain('Ответственные');
    expect(card).toContain('Кухня</b> — Командир');
    expect(card).toContain('Ваше служение: Кухня');

    calls.length = 0;
    await sendText(me, '/schedule');
    const week = String((await sentTo(me.id, 'Расписание'))!.body.text);
    expect(week).toContain('Вечер молодёжи');
    // Who leads and who brings the snacks.
    expect(week).toContain('Ведущий: Командир');
    expect(week).toContain('Снеки: <i>не назначен</i>');
    expect(week).not.toContain('Далёкая встреча');
    expect(week).not.toContain('Лагерь осени'); // 10 days away: not in a week
    await pressButton(me, 'sc:q');
    const edit = [...calls].reverse().find((c) => c.method === 'editMessageText');
    expect(String(edit!.body.text)).toContain('Далёкая встреча');
    expect(String(edit!.body.text)).toContain('Лагерь осени');
    expect(String(edit!.body.text)).toContain('Кухня</b> — Командир');
  });

  it('/events sends an event with a poster as a photo with the details as the caption', async () => {
    const g = await createEnv('Постер события');
    const me = fakeUser('Смотрящий постер');
    await join(me, g);
    const poster = (
      (await (
        await api(`/api/groups/${g.id}/media?kind=event`, {
          method: 'POST',
          user: ADMIN,
          body: PNG,
        })
      ).json()) as { id: number }
    ).id;
    const ev = await apiJson<{ id: number }>(`/api/groups/${g.id}/events`, {
      method: 'POST',
      user: ADMIN,
      json: {
        title: 'Вечер с постером',
        date: addDays(localDate(new Date(), TZ), 5),
        startTime: '18:00',
        posterMediaId: poster,
      },
    });
    calls.length = 0;
    await sendText(me, '/events');
    const photo = callsTo(calls, 'sendPhoto').find((c) =>
      String(c.body.caption).includes('Вечер с постером'),
    );
    expect(photo).toBeTruthy();
    expect(String(photo!.body.photo)).toContain(`/media/m/${poster}?`);

    // Editing can take the poster away.
    await apiJson(`/api/events/${ev.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { posterMediaId: null },
    });
    calls.length = 0;
    await sendText(me, '/events');
    expect(callsTo(calls, 'sendPhoto')).toHaveLength(0);
    expect(await sentTo(me.id, 'Вечер с постером')).toBeTruthy();
  });
});

describe('post posters', () => {
  it('a post made with a poster sends it as the photo; resending reuses it', async () => {
    const g = await createEnv('Постер поста');
    const a = fakeUser('Зритель постера');
    await join(a, g);
    const poster = (
      (await (
        await api(`/api/groups/${g.id}/media?kind=event`, {
          method: 'POST',
          user: ADMIN,
          body: PNG,
        })
      ).json()) as { id: number }
    ).id;
    // A picture from another ministry can't be used.
    const other = await createEnv('Чужое служение');
    const foreign = (
      (await (
        await api(`/api/groups/${other.id}/media?kind=event`, {
          method: 'POST',
          user: ADMIN,
          body: PNG,
        })
      ).json()) as { id: number }
    ).id;
    expect(
      (
        await api(`/api/groups/${g.id}/announcements`, {
          method: 'POST',
          user: ADMIN,
          json: { text: 'x', posterMediaId: foreign },
        })
      ).status,
    ).toBe(400);

    calls.length = 0;
    const post = await apiJson<{ announcement: { id: number } }>(
      `/api/groups/${g.id}/announcements`,
      {
        method: 'POST',
        user: ADMIN,
        json: { title: 'Афиша', text: 'Ждём всех в пятницу', posterMediaId: poster },
      },
    );
    const photo = async () => {
      for (let i = 0; i < 20; i++) {
        const hit = calls.find((c) => c.method === 'sendPhoto' && c.body.chat_id === a.id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 20));
      }
      return undefined;
    };
    const first = await photo();
    expect(String(first!.body.photo)).toContain(`/media/m/${poster}`);
    expect(String(first!.body.caption)).toContain('Ждём всех в пятницу');

    calls.length = 0;
    await apiJson(`/api/announcements/${post.announcement.id}/resend`, {
      method: 'POST',
      user: ADMIN,
      json: {},
    });
    const again = await photo();
    expect(String(again!.body.photo)).toContain(`/media/m/${poster}`);
    expect(String(again!.body.caption)).toContain('Напоминание о публикации');
  });
});
