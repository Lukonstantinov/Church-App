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
import { generateMeetings } from '../src/lib/meetings';
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
