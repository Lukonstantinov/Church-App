import { useSyncExternalStore } from 'react';
import type { EventSummary, PostDesign } from '@church/shared';
import { useT } from '../lib/i18n';

/** Whole days from one local "YYYY-MM-DD" date to another. */
export function daysUntil(date: string, today: string) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
}

// One timer for every counter on screen, ticking each second.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(cb: () => void) {
  listeners.add(cb);
  timer ??= setInterval(() => listeners.forEach((l) => l()), 1000);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
const nowSecond = () => Math.floor(Date.now() / 1000);
const useNowSecond = () => useSyncExternalStore(subscribe, nowSecond);

export const COUNTDOWN_SIZES = ['s', 'm', 'l'] as const;
/** Colours to choose from; null = the flame gradient. */
export const COUNTDOWN_COLORS = ['#111827', '#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#6366f1'];

const SIZE = {
  s: { text: 'text-[11px]', pad: 'px-2 py-0.5', flame: 'text-[13px]' },
  m: { text: 'text-[14px]', pad: 'px-2.5 py-1', flame: 'text-[17px]' },
  l: { text: 'text-[19px]', pad: 'px-3.5 py-1.5', flame: 'text-[24px]' },
} as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

function isLightHex(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  return lum > 150;
}

/** Whether an event shows a counter (it asked for one and hasn't started or been cancelled). */
export const hasCountdown = (e: Pick<EventSummary, 'countdown' | 'status'>) =>
  e.countdown && e.status !== 'cancelled';

/**
 * 🔥 A live counter to an event's start: days, hours, minutes and seconds, with an
 * animated flame. Its size and colour come from the event's design. Nothing once started.
 */
export function CountdownBadge({
  startsAt,
  design,
  compact,
  className = '',
}: {
  startsAt: string;
  design?: Pick<PostDesign, 'countdownSize' | 'countdownColor'> | null;
  /** One size smaller, for small tiles. */
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const now = useNowSecond();
  const total = Math.floor(Date.parse(startsAt) / 1000) - now;
  if (total <= 0) return null;
  const days = Math.floor(total / 86400);
  const clock = `${pad2(Math.floor((total % 86400) / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
  const chosen = design?.countdownSize ?? 'm';
  const size = SIZE[compact ? (chosen === 'l' ? 'm' : 's') : chosen];
  const color = design?.countdownColor ?? null;
  const dark = color ? isLightHex(color) : false;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-bold tabular-nums shadow-card ${size.pad} ${size.text} ${className}`}
      style={{
        background: color ?? 'linear-gradient(135deg, #f59e0b, #ef4444)',
        color: dark ? '#111827' : '#ffffff',
      }}
    >
      <span className={`flame ${size.flame} leading-none`} aria-hidden="true">
        🔥
      </span>
      <span>
        {days > 0 ? `${days}${t.meetings.dayShort} ` : ''}
        {clock}
      </span>
    </span>
  );
}

/** The counter laid over the top of a cover, when the event has one. */
export function CountdownOnCover({
  e,
  compact,
}: {
  e: Pick<EventSummary, 'countdown' | 'status' | 'startsAt' | 'design'>;
  compact?: boolean;
}) {
  if (!hasCountdown(e)) return null;
  return (
    <div className="pointer-events-none absolute left-2.5 top-2.5 z-10">
      <CountdownBadge startsAt={e.startsAt} design={e.design} compact={compact} />
    </div>
  );
}
