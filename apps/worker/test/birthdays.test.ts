import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  addDays,
  DEFAULT_BIRTHDAY_REPORT,
  localDate,
  type CalendarData,
  type MeetingRow,
} from '@church/shared';
import { getDb } from '../src/db/client';
import { sendBirthdayReports } from '../src/jobs/tick';
import { ADMIN, api, apiJson, mockTelegram } from './helpers';

beforeEach(() => {
  mockTelegram();
});
afterEach(() => vi.unstubAllGlobals());

const TZ = 'Europe/Riga';

async function group(name: string) {
  return (
    await apiJson<{ id: number }>('/api/groups', { method: 'POST', user: ADMIN, json: { name } })
  ).id;
}

describe('birthdays', () => {
  it('made-up people: pasted in, in the calendar, in the weekly report, removed again', async () => {
    const g = await group('Дни рождения');
    const now = new Date();
    const today = localDate(now, TZ);
    const soon = addDays(today, 2).slice(5);
    await apiJson('/api/dev/mock-people', {
      method: 'POST',
      user: ADMIN,
      json: {
        groupId: g,
        people: [
          { firstName: 'Тест', lastName: 'Скоро', birthday: soon, birthYear: 2000, role: null },
          { firstName: 'Тест', lastName: 'Потом', birthday: null, birthYear: null, role: null },
        ],
      },
    });
    // The pasted people count like anyone else.
    let cal = await apiJson<CalendarData>(`/api/groups/${g}/calendar`, { user: ADMIN });
    expect(cal.birthdays?.map((b) => b.lastName)).toEqual(['Скоро']);
    await apiJson('/api/dev/mock-people', {
      method: 'PATCH',
      user: ADMIN,
      json: { mockOnly: true },
    });
    cal = await apiJson<CalendarData>(`/api/groups/${g}/calendar`, { user: ADMIN });
    expect(cal.birthdays?.map((b) => b.lastName)).toEqual(['Скоро']);

    // The weekly list goes to the admins at the set hour on the set weekday.
    const db = getDb(env.DB);
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(
        now,
      ),
    );
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    await sendBirthdayReports(
      db,
      { timezone: TZ, birthdayReport: { ...DEFAULT_BIRTHDAY_REPORT, hour, weekday } },
      now,
    );
    const queued = await env.DB.prepare(
      "select payload from outbox where dedupe_key like 'bday-week:%'",
    ).all<{ payload: string }>();
    expect(queued.results.length).toBeGreaterThan(0);
    expect(queued.results[0]!.payload).toContain('Скоро');

    const removed = await apiJson<{ removed: number }>('/api/dev/mock-people', {
      method: 'DELETE',
      user: ADMIN,
    });
    expect(removed.removed).toBe(2);
  });

  it('a person sets their own birthday; others see it only when they manage them', async () => {
    const me = await apiJson<{ user: { id: number } }>('/api/me', { user: ADMIN });
    await apiJson(`/api/users/${me.user.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { birthday: '07-15', birthYear: 1995 },
    });
    const detail = await apiJson<{ user: { birthday: string; birthYear: number } }>(
      `/api/users/${me.user.id}`,
      { user: ADMIN },
    );
    expect(detail.user).toMatchObject({ birthday: '07-15', birthYear: 1995 });
    const bad = await api(`/api/users/${me.user.id}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { birthday: '13-40' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('which meetings count in statistics', () => {
  it('follows the ministry rule, and a meeting can choose for itself', async () => {
    const g = await group('Счёт');
    await apiJson(`/api/groups/${g}`, {
      method: 'PATCH',
      user: ADMIN,
      json: { statKinds: ['regular'] },
    });
    const date = addDays(localDate(new Date(), TZ), 3);
    const make = (json: object) =>
      apiJson<MeetingRow>(`/api/groups/${g}/meetings`, {
        method: 'POST',
        user: ADMIN,
        json: { date, startTime: '18:00', title: 'Встреча', ...json },
      });
    expect((await make({})).countsInStats).toBe(true);
    expect((await make({ kind: 'prayer' })).countsInStats).toBe(false);
    expect((await make({ kind: 'prayer', counts: true })).countsInStats).toBe(true);
    expect((await make({ counts: false })).countsInStats).toBe(false);
  });
});

describe('birthdays from Telegram', () => {
  it('fills an empty birthday from the profile, never over an entered one', async () => {
    const { syncTelegramBirthdays } = await import('../src/lib/birthdays');
    const db = getDb(env.DB);
    await env.DB.prepare(
      "insert into users (telegram_id, first_name) values (777001, 'Из Телеграма'), (777002, 'Свой')",
    ).run();
    await env.DB.prepare("update users set birthday = '01-02' where telegram_id = 777002").run();
    const api = {
      getChat: async () => ({ birthdate: { day: 5, month: 3, year: 1990 } }),
    };
    const first = await syncTelegramBirthdays(db, api);
    expect(first.found).toBeGreaterThan(0);
    const mine = await env.DB.prepare(
      'select telegram_id, birthday, birth_year from users where telegram_id in (777001, 777002) order by telegram_id',
    ).all<{ birthday: string; birth_year: number | null }>();
    expect(mine.results[0]).toMatchObject({ birthday: '03-05', birth_year: 1990 });
    expect(mine.results[1]!.birthday).toBe('01-02');
    // Nobody left without a date: a second run finds nothing more.
    expect((await syncTelegramBirthdays(db, api)).found).toBe(0);
  });
});

describe('birthday weeks', () => {
  it('this week is Monday to Sunday with the days gone by, and the past week is the one before', async () => {
    const { birthdaysBetween, weekAround } = await import('../src/lib/birthdays');
    // Wednesday 4 November 2026.
    expect(weekAround('2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(weekAround('2026-11-04', -1)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    // A Sunday still belongs to the week that began on Monday.
    expect(weekAround('2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    const row = (userId: number, birthday: string) => ({
      userId,
      firstName: `P${userId}`,
      lastName: null,
      birthday,
      birthYear: 1999,
      roles: [],
    });
    const rows = [row(1, '11-03'), row(2, '11-04'), row(3, '11-09'), row(4, '10-30')];
    const week = weekAround('2026-11-04');
    expect(birthdaysBetween(rows, week.from, week.to).map((b) => b.userId)).toEqual([1, 2]);
    const past = weekAround('2026-11-04', -1);
    expect(birthdaysBetween(rows, past.from, past.to).map((b) => b.userId)).toEqual([4]);
    // Across New Year.
    expect(
      birthdaysBetween([row(5, '01-01'), row(6, '12-31')], '2026-12-28', '2027-01-03').map(
        (b) => b.userId,
      ),
    ).toEqual([6, 5]);
  });
});
