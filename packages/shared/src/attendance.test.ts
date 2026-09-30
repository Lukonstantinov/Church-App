import { describe, expect, it } from 'vitest';
import { absenceStreak, attendanceRate } from './attendance';

describe('attendanceRate', () => {
  it('counts present and late as attended and ignores excused', () => {
    expect(attendanceRate(['present', 'late', 'absent', 'excused'])).toEqual({
      percent: 67,
      attended: 2,
      counted: 3,
    });
  });
  it('is null before any counted meeting', () => {
    expect(attendanceRate([]).percent).toBeNull();
    expect(attendanceRate(['excused']).percent).toBeNull();
  });
});

describe('absenceStreak', () => {
  it('counts consecutive recent absences', () => {
    expect(absenceStreak(['absent', 'absent', 'present', 'absent'])).toBe(2);
  });
  it('skips excused meetings without breaking the streak', () => {
    expect(absenceStreak(['absent', 'excused', 'absent', 'present'])).toBe(2);
  });
  it('is zero when the latest meeting was attended', () => {
    expect(absenceStreak(['late', 'absent', 'absent'])).toBe(0);
  });
});
