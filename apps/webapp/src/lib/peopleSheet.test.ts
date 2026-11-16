import { describe, expect, it } from 'vitest';
import { ru, type MemberRow } from '@church/shared';
import { ageOn, peopleTable, sortPeople } from './peopleSheet';

const person = (p: Partial<MemberRow>): MemberRow => ({
  labels: [],
  membershipId: 1,
  positionId: null,
  positionName: null,
  positionLook: null,
  userId: 1,
  firstName: 'Анна',
  lastName: null,
  username: null,
  role: 'member',
  status: 'active',
  joinedAt: null,
  requestedAt: '2026-01-01T00:00:00.000Z',
  offline: false,
  isReachable: true,
  isAdmin: false,
  guardianConsent: false,
  birthday: null,
  birthYear: null,
  lastSeenAt: null,
  recentPercent: null,
  photoUrl: null,
  ...p,
});

describe('table of people', () => {
  it('counts full years up to the birthday', () => {
    expect(ageOn('11-20', 2000, new Date(2026, 10, 16))).toBe(25);
    expect(ageOn('11-16', 2000, new Date(2026, 10, 16))).toBe(26);
  });

  it('keeps the sheet’s column order and writes «нет данных» where nothing is known', () => {
    const table = peopleTable(
      [person({})],
      ['age', 'username', 'firstName', 'lastName', 'birthday', 'attendance', 'telegram'],
      ru,
    );
    expect(table.head).toEqual([
      'Имя',
      'Фамилия',
      'День рождения',
      'Возраст',
      'Telegram',
      'Есть в Telegram',
      'Посещаемость',
    ]);
    expect(table.rows[0]).toEqual([
      'Анна',
      'нет данных',
      'нет данных',
      'нет данных',
      'нет данных',
      'да',
      'нет данных',
    ]);
  });

  it('fills in what is known', () => {
    const table = peopleTable(
      [
        person({
          lastName: 'Иванова',
          username: 'anna',
          birthday: '03-07',
          birthYear: 2005,
          positionName: 'Лидер хвалы',
          labels: [{ id: 1, name: 'Хор' } as MemberRow['labels'][number]],
          recentPercent: 88,
          offline: true,
        }),
      ],
      ['lastName', 'position', 'labels', 'birthday', 'age', 'username', 'telegram', 'attendance'],
      ru,
      new Date(2026, 10, 16),
    );
    expect(table.rows[0]).toEqual([
      'Иванова',
      'Лидер хвалы',
      'Хор',
      '07.03.2005',
      21,
      '@anna',
      'нет',
      '88%',
    ]);
  });

  it('orders by position, then by name', () => {
    const list = [
      person({ userId: 1, firstName: 'Яна', positionId: 2 }),
      person({ userId: 2, firstName: 'Борис', positionId: 1 }),
      person({ userId: 3, firstName: 'Анна', positionId: 2 }),
    ];
    const rank = (m: MemberRow) => m.positionId ?? 99;
    expect(sortPeople(list, rank, false).map((m) => m.firstName)).toEqual(['Борис', 'Анна', 'Яна']);
    expect(sortPeople(list, rank, true).map((m) => m.firstName)).toEqual(['Анна', 'Борис', 'Яна']);
  });
});
