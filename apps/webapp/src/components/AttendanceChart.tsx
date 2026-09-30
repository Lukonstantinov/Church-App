import { useState } from 'react';
import type { AttendancePoint } from '@church/shared';
import { shortDate } from '../lib/format';

const H = 128; // plot height in px

const pct = (p: AttendancePoint) => (p.total === 0 ? 0 : Math.round((p.attended / p.total) * 100));
const ddmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(
    new Date(iso),
  );

/**
 * Attendance per meeting as columns (0–100%). One hue; columns are thin with rounded
 * tops; only the selected column carries a value label — tap another to read it.
 * A table view is available for screen readers and for exact numbers.
 */
export function AttendanceChart({
  series,
  average,
  timezone,
}: {
  series: AttendancePoint[];
  average: number | null;
  timezone: string;
}) {
  const [selected, setSelected] = useState(series.length - 1);
  const [table, setTable] = useState(false);
  const sel = series[Math.min(selected, series.length - 1)];

  if (table) {
    return (
      <div>
        <table className="w-full text-[14px]">
          <thead className="text-left text-[12px] text-hint">
            <tr>
              <th className="py-1 font-medium">Встреча</th>
              <th className="py-1 text-right font-medium">Пришли</th>
              <th className="py-1 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {[...series].reverse().map((p) => (
              <tr key={p.meetingId} className="border-t border-hairline">
                <td className="py-2">{shortDate(p.startsAt, timezone)}</td>
                <td className="py-2 text-right tabular-nums">
                  {p.attended} из {p.total}
                </td>
                <td className="py-2 text-right font-medium tabular-nums">{pct(p)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="mt-2 min-h-[36px] text-[14px] text-link"
          onClick={() => setTable(false)}
        >
          Показать график
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative" style={{ height: H + 20 }}>
        {/* gridlines + y labels */}
        {[100, 50, 0].map((v) => (
          <div
            key={v}
            className="absolute inset-x-0 flex items-center"
            style={{ top: H - (H * v) / 100 }}
          >
            <span className="w-8 pr-2 text-right text-[11px] tabular-nums text-hint">{v}</span>
            <div className="h-px flex-1 bg-hairline" />
          </div>
        ))}
        {average !== null && (
          <div
            className="absolute right-0 h-px bg-text/35"
            style={{ left: 32, top: H - (H * average) / 100 }}
            aria-hidden="true"
          />
        )}
        <div className="absolute inset-y-0 right-0 flex" style={{ left: 32 }}>
          {series.map((p, i) => {
            const on = i === selected;
            const h = Math.max((H * pct(p)) / 100, pct(p) === 0 ? 0 : 3);
            return (
              <button
                key={p.meetingId}
                type="button"
                onClick={() => setSelected(i)}
                aria-label={`${shortDate(p.startsAt, timezone)}: ${p.attended} из ${p.total}, ${pct(p)}%`}
                aria-pressed={on}
                className="relative flex h-full flex-1 flex-col items-center justify-end"
              >
                {on && (
                  <span
                    className="absolute z-10 rounded bg-section px-1 text-[12px] font-semibold tabular-nums"
                    style={{ bottom: 20 + h + 3 }}
                  >
                    {pct(p)}%
                  </span>
                )}
                <span
                  className="flex w-full flex-col items-center justify-end"
                  style={{ height: H }}
                >
                  <span
                    className="w-full max-w-[24px] rounded-t-[4px] bg-chart transition-opacity"
                    style={{ height: h, opacity: on ? 1 : 0.45 }}
                  />
                </span>
                <span
                  className={`mt-1 h-[16px] text-[11px] tabular-nums ${on ? 'text-text' : 'text-hint'}`}
                >
                  {ddmm(p.startsAt, timezone)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate text-hint">
          {sel && (
            <>
              <span className="text-text">{shortDate(sel.startsAt, timezone)}</span> · пришли{' '}
              {sel.attended} из {sel.total}
            </>
          )}
        </span>
        <button
          type="button"
          className="min-h-[36px] shrink-0 text-link"
          onClick={() => setTable(true)}
        >
          Таблица
        </button>
      </div>
    </div>
  );
}
