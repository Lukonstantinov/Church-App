/**
 * Time-zone helpers built on Intl (works in Workers and browsers, no library).
 * Meetings are stored in UTC; schedules ("Friday 19:00") are wall-clock times in
 * the church time zone, so daylight-saving changes never shift a meeting.
 *
 * Weekdays are 0 = Monday … 6 = Sunday.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallTime(ts: number, timeZone: string): Wall {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ts))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as unknown as Wall;
}

/** Offset of `timeZone` from UTC at instant `ts`, in ms (positive east of UTC). */
export function tzOffsetMs(ts: number, timeZone: string): number {
  const w = wallTime(ts, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Wall-clock date + time in `timeZone` → UTC instant. Handles DST gaps/overlaps. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess - tzOffsetMs(guess, timeZone);
  // The offset at the corrected instant can differ across a DST boundary; settle once.
  ts = guess - tzOffsetMs(ts, timeZone);
  return new Date(ts);
}

/** Calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDate(ts: Date | number | string, timeZone: string): string {
  const w = wallTime(new Date(ts).getTime(), timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** 0 = Monday … 6 = Sunday for a calendar date (timezone independent). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** date + n days, as "YYYY-MM-DD" (calendar arithmetic, no DST involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
