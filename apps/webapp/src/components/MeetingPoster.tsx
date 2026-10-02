import { forwardRef } from 'react';
import { displayName, resolveBrand, type GroupSummary, type MeetingRow } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { BackdropLayer, PatternLayer, onBrandStyle } from './PatternLayer';

/**
 * A meeting poster in the ministry's design (colours, pattern, photo, logo) with the
 * title, date, time, topic, place and leader. Rendered off screen and turned into an
 * image to send with the bot message.
 */
export const MeetingPoster = forwardRef<
  HTMLDivElement,
  {
    m: Pick<MeetingRow, 'title' | 'startsAt' | 'endsAt' | 'topic' | 'location' | 'leader' | 'kind'>;
    g: GroupSummary;
    /** Stamped "cancelled" across. */
    cancelled?: boolean;
  }
>(function MeetingPoster({ m, g, cancelled }, ref) {
  const t = useT();
  const f = useFmt();
  const theme = resolveBrand(g.brandColor ?? 'blue');
  const on = onBrandStyle(g.textColor, true);
  const badge = f.dateBadge(m.startsAt);
  // A leaders' meeting has its own look: deep night blue with gold.
  const leaders = m.kind === 'leaders';
  return (
    <div
      ref={ref}
      className={`relative flex h-[675px] w-[540px] flex-col overflow-hidden p-10 ${
        leaders ? 'text-white' : on.className
      }`}
      style={
        leaders
          ? { background: 'linear-gradient(155deg, #0b1220 0%, #1e293b 55%, #3b2f12 100%)' }
          : { ...on.style, background: `linear-gradient(150deg, ${theme.light}, ${theme.partner})` }
      }
    >
      {leaders ? (
        <>
          <span
            aria-hidden="true"
            className="absolute -right-24 -top-24 h-80 w-80 rounded-full"
            style={{ background: 'radial-gradient(circle, #d4af3755, transparent 70%)' }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-4 rounded-[28px] border-2"
            style={{ borderColor: '#d4af3799' }}
          />
        </>
      ) : (
        <>
          <PatternLayer pattern={g.pattern} logoUrl={g.logoUrl} />
          <BackdropLayer backdrop={g.backdrop} url={g.backdropUrl} />
        </>
      )}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent"
      />
      <div className="relative flex items-center gap-3">
        {g.logoUrl && (
          <img
            src={g.logoUrl}
            alt=""
            className="h-14 w-14 rounded-2xl bg-white object-contain p-1"
          />
        )}
        <span className="text-[20px] font-bold uppercase tracking-wider">{g.name}</span>
      </div>
      {leaders && (
        <div
          className="relative mt-6 self-start rounded-full px-5 py-2 text-[20px] font-extrabold uppercase tracking-widest text-[#1a1406]"
          style={{ background: 'linear-gradient(90deg, #f5d77a, #d4af37, #b8902a)' }}
        >
          👑 {t.meetings.kinds.leaders}
        </div>
      )}
      <div className="relative mt-auto flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-[96px] w-[96px] flex-col items-center justify-center rounded-3xl bg-white/22 backdrop-blur">
            <span className="text-[16px] font-bold uppercase">{badge.weekday}</span>
            <span className="text-[44px] font-extrabold leading-none">{badge.day}</span>
            <span className="text-[15px] font-semibold">{badge.month}</span>
          </div>
          <div className="min-w-0">
            <div className="text-[40px] font-extrabold leading-[1.05]">{m.title}</div>
            <div className="mt-1 text-[22px] font-semibold opacity-90">
              {f.timeRange(m.startsAt, m.endsAt)}
            </div>
          </div>
        </div>
        {m.topic && <div className="text-[28px] font-bold leading-tight">«{m.topic}»</div>}
        <div className="flex flex-wrap gap-2 text-[19px] font-semibold">
          {m.leader && (
            <span
              className={`rounded-full px-4 py-1.5 ${leaders ? 'text-[#1a1406]' : 'bg-white text-[var(--brand)]'}`}
              style={leaders ? { background: '#d4af37' } : undefined}
            >
              🎤 {displayName(m.leader)}
            </span>
          )}
          {m.kind && !leaders && (
            <span className="rounded-full bg-white/22 px-4 py-1.5">{t.meetings.kinds[m.kind]}</span>
          )}
          {m.location && (
            <span className="rounded-full bg-white/22 px-4 py-1.5">📍 {m.location}</span>
          )}
        </div>
      </div>
      {cancelled && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <span className="-rotate-12 rounded-2xl border-[6px] border-[#ef4444] bg-white/90 px-8 py-3 text-[56px] font-black tracking-widest text-[#ef4444]">
            {t.meetings.cancelledStamp}
          </span>
        </div>
      )}
    </div>
  );
});
