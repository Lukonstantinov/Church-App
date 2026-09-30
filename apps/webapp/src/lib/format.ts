/** Russian date/time formatting in the church time zone. */

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('ru-RU', { timeZone, ...opts });
    cache.set(key, f);
  }
  return f;
}

/** "26 сентября" */
export const dayMonth = (iso: string, tz: string) =>
  fmt(tz, { day: 'numeric', month: 'long' }).format(new Date(iso));

/** "пт, 26 сентября" */
export const weekdayDayMonth = (iso: string, tz: string) =>
  fmt(tz, { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(iso));

/** "пт, 26 сент." */
export const shortDate = (iso: string, tz: string) =>
  fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(iso))
    .replace(/\.$/, '');

export const timeOfDay = (iso: string, tz: string) =>
  fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** "19:00–21:00" */
export const timeRange = (startIso: string, endIso: string, tz: string) =>
  `${timeOfDay(startIso, tz)}–${timeOfDay(endIso, tz)}`;

/** { day: "26", month: "сент" } for calendar-style badges. */
export function dateBadge(iso: string, tz: string) {
  const d = new Date(iso);
  return {
    day: fmt(tz, { day: 'numeric' }).format(d),
    month: fmt(tz, { month: 'short' }).format(d).replace(/\.$/, ''),
    weekday: fmt(tz, { weekday: 'short' }).format(d),
  };
}

/** "Сентябрь 2026" — used for grouping lists. */
export const monthYear = (iso: string, tz: string) => {
  const s = fmt(tz, { month: 'long', year: 'numeric' })
    .format(new Date(iso))
    .replace(/\s*г\.$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const ymd = (d: Date, tz: string) =>
  fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Whole calendar days from `now` to `iso` in the church zone (0 = today, -1 = yesterday). */
export function daysFromToday(iso: string, tz: string, now = new Date()): number {
  const a = ymd(new Date(iso), tz).split('.').reverse().join('-');
  const b = ymd(now, tz).split('.').reverse().join('-');
  return Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

/** "Сегодня", "Завтра", "Вчера", "через 3 дня", "3 дня назад". */
export function relativeDay(iso: string, tz: string, now = new Date()): string {
  const n = daysFromToday(iso, tz, now);
  if (n === 0) return 'Сегодня';
  if (n === 1) return 'Завтра';
  if (n === -1) return 'Вчера';
  const abs = Math.abs(n);
  const word = pluralDays(abs);
  return n > 0 ? `через ${abs} ${word}` : `${abs} ${word} назад`;
}

function pluralDays(n: number): string {
  const r = new Intl.PluralRules('ru-RU').select(n);
  return r === 'one' ? 'день' : r === 'few' ? 'дня' : 'дней';
}

/** "Пн", "Вт"… indexed 0 = Monday, matching the API's weekday numbers. */
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAYS_LONG = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];
/** Accusative after "каждую/каждый": "каждую пятницу". */
export const WEEKDAYS_EVERY = [
  'каждый понедельник',
  'каждый вторник',
  'каждую среду',
  'каждый четверг',
  'каждую пятницу',
  'каждую субботу',
  'каждое воскресенье',
];

/** "1 ч", "1,5 ч", "2 ч", "45 мин" */
export function durationLabel(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} ч`;
}

/** Local "YYYY-MM-DD" for <input type="date"> defaults. */
export function todayInput(tz: string, now = new Date()): string {
  return ymd(now, tz).split('.').reverse().join('-');
}
