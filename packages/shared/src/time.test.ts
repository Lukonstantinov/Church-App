import { describe, expect, it } from 'vitest';
import { addDays, localDate, weekdayOf, zonedToUtc } from './time';

describe('zonedToUtc (Europe/Riga)', () => {
  it('uses UTC+3 in summer and UTC+2 in winter', () => {
    expect(zonedToUtc('2026-09-25', '19:00', 'Europe/Riga').toISOString()).toBe(
      '2026-09-25T16:00:00.000Z',
    );
    expect(zonedToUtc('2026-12-04', '19:00', 'Europe/Riga').toISOString()).toBe(
      '2026-12-04T17:00:00.000Z',
    );
  });

  it('keeps 19:00 local across the spring and autumn DST changes', () => {
    // Riga: clocks forward Sun 2026-03-29, back Sun 2026-10-25.
    expect(zonedToUtc('2026-03-27', '19:00', 'Europe/Riga').toISOString()).toBe(
      '2026-03-27T17:00:00.000Z',
    );
    expect(zonedToUtc('2026-04-03', '19:00', 'Europe/Riga').toISOString()).toBe(
      '2026-04-03T16:00:00.000Z',
    );
    expect(zonedToUtc('2026-10-23', '19:00', 'Europe/Riga').toISOString()).toBe(
      '2026-10-23T16:00:00.000Z',
    );
    expect(zonedToUtc('2026-10-30', '19:00', 'Europe/Riga').toISOString()).toBe(
      '2026-10-30T17:00:00.000Z',
    );
  });

  it('works for a zone west of UTC', () => {
    expect(zonedToUtc('2026-07-01', '08:30', 'America/New_York').toISOString()).toBe(
      '2026-07-01T12:30:00.000Z',
    );
  });
});

describe('date helpers', () => {
  it('localDate reads the calendar day in the given zone', () => {
    expect(localDate('2026-09-25T22:30:00Z', 'Europe/Riga')).toBe('2026-09-26');
    expect(localDate('2026-09-25T22:30:00Z', 'UTC')).toBe('2026-09-25');
  });

  it('weekdayOf is Monday-based', () => {
    expect(weekdayOf('2026-09-28')).toBe(0); // Monday
    expect(weekdayOf('2026-09-25')).toBe(4); // Friday
    expect(weekdayOf('2026-09-27')).toBe(6); // Sunday
  });

  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
