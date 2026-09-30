import { describe, expect, it } from 'vitest';
import { addMonths, parseAmount, signedCents, yearPeriods } from './finance';

describe('parseAmount', () => {
  it('accepts comma or dot decimals and spaces', () => {
    expect(parseAmount('5')).toBe(500);
    expect(parseAmount('5,5')).toBe(550);
    expect(parseAmount('12.34')).toBe(1234);
    expect(parseAmount('1 234,50')).toBe(123_450);
  });
  it('rejects zero, negatives, junk and too many decimals', () => {
    for (const bad of ['', '0', '-5', 'abc', '1.234', '1,2,3']) expect(parseAmount(bad)).toBeNull();
  });
});

describe('periods', () => {
  it('adds months across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(yearPeriods(2026)[0]).toBe('2026-01');
    expect(yearPeriods(2026)[11]).toBe('2026-12');
  });
  it('signs outgoing kinds negative', () => {
    expect(signedCents('expense', 100)).toBe(-100);
    expect(signedCents('event_expense', 100)).toBe(-100);
    expect(signedCents('dues', 100)).toBe(100);
  });
});
