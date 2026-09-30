import type { EventSummary } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { IconCheck, IconMapPin, IconUsers } from './icons';
import { useMoney } from './money';
import { Badge, DateBadge } from './ui';

/** "пт, 2 окт · 18:00" or a date range for multi-day events. */
export function useEventWhen() {
  const f = useFmt();
  return (e: Pick<EventSummary, 'startsAt' | 'endsAt'>) => {
    const start = `${f.weekdayDayMonth(e.startsAt)} · ${f.time(e.startsAt)}`;
    if (!e.endsAt) return start;
    return f.todayInput(new Date(e.startsAt)) === f.todayInput(new Date(e.endsAt))
      ? `${start}–${f.time(e.endsAt)}`
      : `${f.dayMonth(e.startsAt)} – ${f.dayMonth(e.endsAt)}`;
  };
}

/** Event list card: cover (or brand tile), date, title, place, quick facts. */
export function EventCard({
  e,
  onClick,
  showGroup,
}: {
  e: EventSummary;
  onClick: () => void;
  showGroup?: boolean;
}) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const when = useEventWhen();
  const cancelled = e.status === 'cancelled';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass block w-full overflow-hidden rounded-[var(--radius-card)] text-left shadow-card transition active:scale-[0.99] ${cancelled ? 'opacity-60' : ''}`}
    >
      {e.coverUrl && (
        <img src={e.coverUrl} alt="" className="aspect-[16/7] w-full object-cover" loading="lazy" />
      )}
      <div className="flex items-start gap-3 p-4">
        <DateBadge {...f.dateBadge(e.startsAt)} muted={cancelled} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-[17px] font-semibold ${cancelled ? 'line-through' : ''}`}
            >
              {e.title}
            </span>
            {cancelled && <Badge tone="danger">{t.events.cancelled}</Badge>}
          </div>
          <div className="truncate text-[14px] text-hint">
            {showGroup ? `${e.groupName} · ` : ''}
            {when(e)}
          </div>
          {e.location && (
            <div className="mt-0.5 flex items-center gap-1 truncate text-[14px] text-hint">
              <IconMapPin size={14} className="shrink-0" />
              <span className="truncate">{e.location}</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {e.features.rsvp && (
              <Badge tone={e.myRsvp === 'going' ? 'success' : 'hint'}>
                {e.myRsvp === 'going' ? <IconCheck size={12} /> : <IconUsers size={12} />}
                {e.myRsvp === 'going' ? t.events.youGoing : t.events.goingCount(e.goingCount)}
              </Badge>
            )}
            {e.myRoles.length > 0 && <Badge>{e.myRoles.join(', ')}</Badge>}
            {e.features.cost && e.priceCents ? (
              <Badge tone="hint">{money(e.priceCents)}</Badge>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
