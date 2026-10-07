import type { ReactNode } from 'react';
import type { MeetingMotion } from '@church/shared';
import { isLiveWindow, useNowSecond } from '../lib/live';
import { useT } from '../lib/i18n';

/** A pulsing red "LIVE" pill: something is going on right now. */
export function LiveBadge({ compact, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <span
      role="status"
      className={`live-badge inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-extrabold uppercase tracking-wider text-white shadow-card ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-[13px]'
      } ${className}`}
    >
      <span className="live-dot" aria-hidden="true" />
      LIVE
    </span>
  );
}

/** The LIVE pill while the event or meeting is going on; nothing before or after. */
export function LiveNow({
  startsAt,
  endsAt,
  cancelled,
  compact,
  className,
}: {
  startsAt: string;
  endsAt?: string | null;
  cancelled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  useNowSecond();
  if (cancelled || !isLiveWindow(startsAt, endsAt)) return null;
  return <LiveBadge compact={compact} className={className} />;
}

/** LIVE laid over the top of a cover (where the countdown sits before the start). */
export function LiveOnCover(props: Parameters<typeof LiveNow>[0]) {
  return (
    <div className="pointer-events-none absolute left-2.5 top-2.5 z-10">
      <LiveNow {...props} />
    </div>
  );
}

/** How long before a meeting its timer shows (and its card starts to pulse). */
export const SOON_MS = 2 * 3_600_000;

/** Whether something starts within the next two hours (re-checked every second). */
export function useStartsSoon(startsAt: string, cancelled?: boolean): boolean {
  const now = useNowSecond() * 1000;
  const left = Date.parse(startsAt) - now;
  return !cancelled && left > 0 && left <= SOON_MS;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "⏳ 1:23:45" counting down the last two hours before the start; nothing otherwise. */
export function SoonTimer({
  startsAt,
  cancelled,
  compact,
  className = '',
}: {
  startsAt: string;
  cancelled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const now = useNowSecond();
  const left = Math.floor(Date.parse(startsAt) / 1000) - now;
  if (cancelled || left <= 0 || left * 1000 > SOON_MS) return null;
  const clock = `${Math.floor(left / 3600)}:${pad2(Math.floor((left % 3600) / 60))}:${pad2(left % 60)}`;
  return (
    <span
      aria-label={`${t.meetings.startsIn} ${clock}`}
      className={`soon-timer inline-flex items-center gap-1 whitespace-nowrap rounded-full font-bold tabular-nums text-white shadow-card ${
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-[14px]'
      } ${className}`}
    >
      <span aria-hidden="true">⏳</span>
      {clock}
    </span>
  );
}

/** Wraps a meeting's card: it pulses slowly during the last two hours before the start. */
export function SoonPulse({
  startsAt,
  cancelled,
  motion = 'calm',
  className = '',
  children,
}: {
  startsAt: string;
  cancelled?: boolean;
  /** The meeting's animation level: off = no pulse, calm = a faint slow one. */
  motion?: MeetingMotion;
  className?: string;
  children: ReactNode;
}) {
  const soon = useStartsSoon(startsAt, cancelled) && motion !== 'off';
  return (
    <div className={`${soon ? `soon-pulse ${motion === 'calm' ? 'calm' : ''}` : ''} ${className}`}>
      {children}
    </div>
  );
}
