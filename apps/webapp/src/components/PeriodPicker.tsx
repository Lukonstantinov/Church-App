import { useState } from 'react';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import type { ReportPeriod } from '../lib/queries';
import { IconChevronRight } from './icons';
import { Segmented, TextField } from './ui';

type Mode = 'year' | 'month' | 'range';

const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (d: string) => d.split('-').reverse().join('.');
/** First and last day of a "YYYY-MM" month. */
const monthSpan = (ym: string): ReportPeriod => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: `${ym}-01`, to: `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
};

/** A year, a month, or a from..to range; `label` names it in titles and file names. */
export function usePeriod(initial: Mode = 'year') {
  const f = useFmt();
  const today = f.todayInput();
  const thisYear = Number(today.slice(0, 4));
  const [mode, setMode] = useState<Mode>(initial);
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const period: ReportPeriod =
    mode === 'year'
      ? { from: `${year}-01-01`, to: `${year}-12-31` }
      : mode === 'month'
        ? monthSpan(month)
        : { from, to };
  const label =
    mode === 'year'
      ? String(year)
      : mode === 'month'
        ? f.periodLong(month)
        : `${dmy(from)}–${dmy(to)}`;
  const ok = mode !== 'range' || (from <= to && from.length === 10 && to.length === 10);
  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  return {
    mode,
    setMode,
    year,
    setYear,
    month,
    shiftMonth,
    from,
    setFrom,
    to,
    setTo,
    period,
    label,
    ok,
    thisYear,
    today,
  };
}

export type PeriodState = ReturnType<typeof usePeriod>;

export function PeriodPicker({ p }: { p: PeriodState }) {
  const t = useT();
  const f = useFmt();
  return (
    <>
      <Segmented
        value={p.mode}
        onChange={p.setMode}
        options={[
          { key: 'year', label: t.reports.year },
          { key: 'month', label: t.reports.month },
          { key: 'range', label: t.reports.range },
        ]}
      />
      {p.mode === 'range' ? (
        <div className="glass flex gap-3 rounded-2xl p-3 shadow-card">
          <div className="min-w-0 flex-1">
            <TextField label={t.reports.from} type="date" value={p.from} onChange={p.setFrom} />
          </div>
          <div className="min-w-0 flex-1">
            <TextField label={t.reports.to} type="date" value={p.to} onChange={p.setTo} />
          </div>
        </div>
      ) : (
        <div className="glass flex items-center justify-between rounded-2xl p-1.5 shadow-card">
          <button
            type="button"
            aria-label="previous"
            className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-hairline"
            onClick={() => (p.mode === 'year' ? p.setYear((y) => y - 1) : p.shiftMonth(-1))}
          >
            <IconChevronRight size={18} className="rotate-180" />
          </button>
          <span className="text-[17px] font-semibold tabular-nums">
            {p.mode === 'year' ? `${t.reports.year} ${p.year}` : f.periodLong(p.month)}
          </span>
          <button
            type="button"
            aria-label="next"
            disabled={p.mode === 'year' ? p.year >= p.thisYear : p.month >= p.today.slice(0, 7)}
            className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-hairline disabled:opacity-30"
            onClick={() => (p.mode === 'year' ? p.setYear((y) => y + 1) : p.shiftMonth(1))}
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      )}
      {!p.ok && (
        <p className="px-3 text-[13px] text-absent">
          {t.reports.from} ≤ {t.reports.to}
        </p>
      )}
    </>
  );
}
