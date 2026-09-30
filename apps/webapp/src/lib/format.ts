import { useMemo } from 'react';
import type { Locale, Messages } from '@church/shared';
import { INTL_LOCALE, messages } from '@church/shared';
import { useI18n } from './i18n';
import { useMe } from './queries';

/** Date/time formatting in the church time zone and the user's language. */
export function makeFormatters(locale: Locale, tz: string, t: Messages = messages(locale)) {
  const intl = INTL_LOCALE[locale];
  const cache = new Map<string, Intl.DateTimeFormat>();
  const fmt = (opts: Intl.DateTimeFormatOptions) => {
    const key = JSON.stringify(opts);
    let f = cache.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat(intl, { timeZone: tz, ...opts });
      cache.set(key, f);
    }
    return f;
  };
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase(intl) + s.slice(1);
  const noDot = (s: string) => s.replace(/\.$/, '');
  const ymd = (d: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
  };
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: 'auto' });

  const daysFromToday = (iso: string, now = new Date()) =>
    Math.round((Date.parse(ymd(new Date(iso))) - Date.parse(ymd(now))) / 86_400_000);

  const weekdayNames = (style: 'short' | 'long') => {
    // 2024-01-01 was a Monday; format seven consecutive noons in UTC.
    const f = new Intl.DateTimeFormat(intl, { weekday: style, timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) =>
      cap(noDot(f.format(new Date(Date.UTC(2024, 0, 1 + i, 12))))),
    );
  };

  return {
    /** "26 сентября" / "26 September" / "rugsėjo 26 d." */
    dayMonth: (iso: string) => fmt({ day: 'numeric', month: 'long' }).format(new Date(iso)),
    /** "пт, 26 сентября" */
    weekdayDayMonth: (iso: string) =>
      fmt({ weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(iso)),
    /** "пт, 26 сент." */
    shortDate: (iso: string) =>
      noDot(fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))),
    /** "26.09" */
    ddmm: (iso: string) => fmt({ day: '2-digit', month: '2-digit' }).format(new Date(iso)),
    time: (iso: string) =>
      fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)),
    timeRange(startIso: string, endIso: string) {
      return `${this.time(startIso)}–${this.time(endIso)}`;
    },
    dateBadge: (iso: string) => {
      const d = new Date(iso);
      const month = noDot(fmt({ month: 'short' }).format(d));
      return {
        day: fmt({ day: 'numeric' }).format(d),
        // Some languages (Lithuanian) format a lone short month as a number.
        month: /^\d+$/.test(month) ? (t.time.monthsShort[Number(month) - 1] ?? month) : month,
        weekday: noDot(fmt({ weekday: 'short' }).format(d)),
      };
    },
    /** "Сентябрь 2026" — standalone month name + year, for list headers. */
    monthYear: (iso: string) => {
      const d = new Date(iso);
      return `${cap(fmt({ month: 'long' }).format(d))} ${fmt({ year: 'numeric' }).format(d).replace(/\D/g, '')}`;
    },
    daysFromToday,
    /** "Сегодня", "Завтра", "Через 3 дня", "3 дня назад" (Intl.RelativeTimeFormat). */
    relativeDay: (iso: string, now = new Date()) => cap(rtf.format(daysFromToday(iso, now), 'day')),
    /** "Пн".."Вс" indexed 0 = Monday. */
    weekdaysShort: weekdayNames('short'),
    weekdaysLong: weekdayNames('long'),
    /** "каждую пятницу" */
    every: (weekday: number) => t.time.every[weekday] ?? '',
    /** "45 мин", "1,5 ч" */
    duration: (min: number) => {
      if (min < 60) return t.time.minutes(min);
      const h = min / 60;
      return t.time.hours(new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(h));
    },
    /** "окт" for a "YYYY-MM" period. */
    monthShort: (period: string) => t.time.monthsShort[Number(period.slice(5, 7)) - 1] ?? period,
    /** "Октябрь 2026" for a "YYYY-MM" period. */
    periodLong(period: string) {
      return this.monthYear(`${period}-15T12:00:00Z`);
    },
    /** "12 окт" for a "YYYY-MM-DD" date. */
    dayMonthShort: (date: string) =>
      `${Number(date.slice(8, 10))} ${t.time.monthsShort[Number(date.slice(5, 7)) - 1] ?? ''}`,
    /** "5 €", "12,50 €", "+5 €" — whole amounts without decimals. */
    money: (cents: number, currency: string, opts: { sign?: boolean } = {}) => {
      const digits = cents % 100 === 0 ? 0 : 2;
      const s = new Intl.NumberFormat(intl, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: opts.sign ? 'exceptZero' : 'auto',
      }).format(cents / 100);
      return s.replace('-', '−');
    },
    /** Local "YYYY-MM-DD" for date inputs. */
    todayInput: (now = new Date()) => ymd(now),
  };
}

export type Formatters = ReturnType<typeof makeFormatters>;

export function useFmt(): Formatters {
  const { locale, t } = useI18n();
  const me = useMe();
  const tz = me.data?.church.timezone ?? 'Europe/Riga';
  return useMemo(() => makeFormatters(locale, tz, t), [locale, tz, t]);
}
