import { describe, expect, it } from 'vitest';
import { dateBadge, daysFromToday, durationLabel, relativeDay, timeRange } from './format';

const TZ = 'Europe/Riga';

describe('format', () => {
  it('formats times in the church zone', () => {
    expect(timeRange('2026-09-25T16:00:00Z', '2026-09-25T18:00:00Z', TZ)).toBe('19:00–21:00');
  });

  it('builds calendar badges', () => {
    expect(dateBadge('2026-09-25T16:00:00Z', TZ)).toMatchObject({ day: '25', weekday: 'пт' });
  });

  it('counts calendar days in the church zone, not UTC days', () => {
    const now = new Date('2026-09-25T20:30:00Z'); // 23:30 in Riga, still the 25th
    expect(daysFromToday('2026-09-25T21:30:00Z', TZ, now)).toBe(1); // 00:30 on the 26th
    expect(relativeDay('2026-09-25T16:00:00Z', TZ, now)).toBe('Сегодня');
    expect(relativeDay('2026-09-26T16:00:00Z', TZ, now)).toBe('Завтра');
    expect(relativeDay('2026-09-24T16:00:00Z', TZ, now)).toBe('Вчера');
    expect(relativeDay('2026-09-28T16:00:00Z', TZ, now)).toBe('через 3 дня');
    expect(relativeDay('2026-09-20T16:00:00Z', TZ, now)).toBe('5 дней назад');
  });

  it('labels durations', () => {
    expect(durationLabel(45)).toBe('45 мин');
    expect(durationLabel(90)).toBe('1,5 ч');
    expect(durationLabel(120)).toBe('2 ч');
  });
});
