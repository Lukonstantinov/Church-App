import type { EventSummary } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';

/** Whole days from today to a local "YYYY-MM-DD" date. */
export function daysUntil(date: string, today: string) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
}

/**
 * 🔥 How many days are left to an event, with a bar that fills from when the event
 * was created to its day. Only for events that asked for it; nothing once it's over.
 */
export function CountdownBar({
  e,
  onBrand,
  compact,
}: {
  e: Pick<EventSummary, 'startsAt' | 'createdAt' | 'countdown' | 'status'>;
  onBrand?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const f = useFmt();
  if (!e.countdown || e.status === 'cancelled') return null;
  const left = daysUntil(f.dateInput(e.startsAt), f.todayInput());
  if (left < 0) return null;
  // Filled by the days gone since the event was created.
  const total = daysUntil(f.dateInput(e.startsAt), f.dateInput(e.createdAt));
  const pct = left === 0 || total <= 0 ? 100 : Math.max(4, ((total - left) / total) * 100);
  return (
    <div className={`flex items-center gap-2 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
      <span
        className={`shrink-0 font-bold tabular-nums ${onBrand ? 'text-white' : 'text-[#ea580c]'}`}
      >
        🔥 {left === 0 ? t.meetings.today : t.meetings.daysLeft(left)}
      </span>
      <span
        className={`h-1.5 min-w-0 flex-1 overflow-hidden rounded-full ${onBrand ? 'bg-white/30' : 'bg-hairline'}`}
      >
        <span
          className="block h-full rounded-full bg-gradient-to-r from-[#f59e0b] to-[#ef4444]"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
