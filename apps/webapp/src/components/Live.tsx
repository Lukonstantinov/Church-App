import { isLiveWindow, useNowSecond } from '../lib/live';

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
