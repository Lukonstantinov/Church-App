import type { AttendanceStatus } from './api';

/**
 * Attendance rate for one member: (present + late) ÷ (meetings held, excused excluded).
 * `statuses` has one entry per held meeting since the member joined (unmarked = absent).
 * Returns null when nothing counts yet.
 */
export function attendanceRate(statuses: AttendanceStatus[]): {
  percent: number | null;
  attended: number;
  counted: number;
} {
  let attended = 0;
  let counted = 0;
  for (const s of statuses) {
    if (s === 'excused') continue;
    counted++;
    if (s === 'present' || s === 'late') attended++;
  }
  return {
    percent: counted === 0 ? null : Math.round((attended / counted) * 100),
    attended,
    counted,
  };
}

/**
 * Consecutive absences counting back from the most recent meeting. Excused meetings
 * are skipped (they neither extend nor break the streak); attending ends it.
 * `newestFirst` is the member's statuses for held meetings, newest first.
 */
export function absenceStreak(newestFirst: AttendanceStatus[]): number {
  let streak = 0;
  for (const s of newestFirst) {
    if (s === 'excused') continue;
    if (s === 'absent') streak++;
    else break;
  }
  return streak;
}

export const ROLL_EDIT_WINDOW_DAYS = 14;
