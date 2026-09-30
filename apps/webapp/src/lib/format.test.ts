import { describe, expect, it } from 'vitest';
import { makeFormatters } from './format';

const TZ = 'Europe/Riga';
const ru = makeFormatters('ru', TZ);
const en = makeFormatters('en', TZ);
const lt = makeFormatters('lt', TZ);

describe('formatters', () => {
  it('formats times in the church zone', () => {
    expect(ru.timeRange('2026-09-25T16:00:00Z', '2026-09-25T18:00:00Z')).toBe('19:00–21:00');
  });

  it('builds calendar badges in each language', () => {
    expect(ru.dateBadge('2026-09-25T16:00:00Z')).toMatchObject({ day: '25', weekday: 'пт' });
    expect(en.dateBadge('2026-09-25T16:00:00Z')).toMatchObject({ day: '25', weekday: 'Fri' });
  });

  it('counts calendar days in the church zone and names them per language', () => {
    const now = new Date('2026-09-25T20:30:00Z'); // 23:30 in Riga, still the 25th
    expect(ru.daysFromToday('2026-09-25T21:30:00Z', now)).toBe(1);
    expect(ru.relativeDay('2026-09-25T16:00:00Z', now)).toBe('Сегодня');
    expect(ru.relativeDay('2026-09-26T16:00:00Z', now)).toBe('Завтра');
    expect(ru.relativeDay('2026-09-28T16:00:00Z', now)).toBe('Через 3 дня');
    expect(en.relativeDay('2026-09-26T16:00:00Z', now)).toBe('Tomorrow');
    expect(lt.relativeDay('2026-09-25T16:00:00Z', now)).toBe('Šiandien');
  });

  it('names weekdays Monday-first and durations per language', () => {
    expect(ru.weekdaysShort[0]).toBe('Пн');
    expect(en.weekdaysShort[4]).toBe('Fri');
    expect(ru.every(4)).toBe('каждую пятницу');
    expect(lt.every(4)).toBe('kiekvieną penktadienį');
    expect(ru.duration(90)).toBe('1,5 ч');
    expect(en.duration(120)).toBe('2 h');
    expect(lt.duration(45)).toBe('45 min.');
  });

  it('builds month headers with the nominative month name', () => {
    expect(ru.monthYear('2026-09-25T16:00:00Z')).toBe('Сентябрь 2026');
    expect(en.monthYear('2026-09-25T16:00:00Z')).toBe('September 2026');
  });
});
