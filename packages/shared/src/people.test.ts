import { describe, expect, it } from 'vitest';
import { parseMockPeople, readDate } from './people';

describe('pasted people', () => {
  it('reads names, birthdays in several forms and a position', () => {
    const { people, bad } = parseMockPeople(
      [
        'Anna Petrova — 14.05.2001 — Лидер',
        'Ivan Ivanov, 03.11',
        'Maria; 1999-12-24',
        '',
        'Jonas 31.02.2000',
        'Без даты',
      ].join('\n'),
    );
    expect(bad).toEqual([5]);
    expect(people).toEqual([
      { firstName: 'Anna', lastName: 'Petrova', birthday: '05-14', birthYear: 2001, role: 'Лидер' },
      { firstName: 'Ivan', lastName: 'Ivanov', birthday: '11-03', birthYear: null, role: null },
      { firstName: 'Maria', lastName: null, birthday: '12-24', birthYear: 1999, role: null },
      { firstName: 'Без', lastName: 'даты', birthday: null, birthYear: null, role: null },
    ]);
  });

  it('refuses dates that do not exist', () => {
    expect(readDate('29.02')).toEqual({ birthday: '02-29', birthYear: null });
    expect(readDate('32.01.2000')).toBeNull();
    expect(readDate('12.13')).toBeNull();
  });
});
