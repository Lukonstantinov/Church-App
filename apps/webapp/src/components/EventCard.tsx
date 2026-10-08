import type { EventSummary } from '@church/shared';
import { useFmt } from '../lib/format';
import { BurnFrame } from './Burn';
import { LiveNow } from './Live';
import { CountdownBadge, CountdownOnCover, hasCountdown } from './Countdown';
import { useT } from '../lib/i18n';
import { IconCheck, IconMapPin, IconUsers } from './icons';
import { PosterMedia } from './Poster';
import { useMoney } from './money';
import { CoverEffectLayers } from './CoverEffects';
import { CoverPicture } from './CoverSlideshow';
import { LayeredPoster, usePosterTexts } from './LayeredPoster';
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

/**
 * An event's cover: its photo, or (when the event has a cover design) the designed
 * banner with the title, like a post — with the event's own animation over it (a TV
 * glitch tears the photo itself). Nothing when neither is set.
 */
export function EventCover({
  e,
  className = 'aspect-[16/7]',
  compact,
}: {
  e: Pick<EventSummary, 'coverUrl' | 'design' | 'look' | 'title'> &
    Partial<
      Pick<
        EventSummary,
        | 'speakers'
        | 'speakerLook'
        | 'motion'
        | 'motionTune'
        | 'motionLayers'
        | 'coverSlides'
        | 'coverLoop'
        | 'poster'
        | 'startsAt'
        | 'endsAt'
        | 'location'
      >
    >;
  className?: string;
  compact?: boolean;
}) {
  const texts = usePosterTexts();
  // A poster template (Design → Posters) takes the cover's place, the event's effects on top.
  if (e.poster)
    return (
      <LayeredPoster
        tpl={e.poster}
        texts={texts({
          title: e.title,
          startsAt: e.startsAt ?? new Date().toISOString(),
          endsAt: e.endsAt,
          location: e.location,
        })}
        coverUrl={e.coverUrl}
        className={`w-full ${className}`}
      >
        <CoverEffectLayers e={e} image={e.coverUrl} />
      </LayeredPoster>
    );
  const layer = <CoverEffectLayers e={e} image={e.coverUrl} />;
  if (e.coverUrl)
    return (
      <div className={`relative w-full overflow-hidden ${className}`}>
        <CoverPicture e={e} />
      </div>
    );
  if (!e.design?.banner) return null;
  return (
    <div className="relative overflow-hidden">
      <PosterMedia
        title={e.title}
        photos={[]}
        tint={null}
        look={e.look}
        // Its own speaker-photo setting, else its template's.
        design={{ ...e.design, speakerLook: e.speakerLook ?? e.design.speakerLook ?? null }}
        compact={compact}
        speakers={e.speakers}
      />
      {layer}
    </div>
  );
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
    <BurnFrame e={e} radius="var(--radius-card)">
      <button
        type="button"
        onClick={onClick}
        className={`glass block w-full overflow-hidden rounded-[var(--radius-card)] text-left shadow-card transition active:scale-[0.99] ${cancelled ? 'opacity-60' : ''}`}
      >
        {e.coverUrl || e.design?.banner || e.poster ? (
          <div className="relative">
            <EventCover e={e} />
            <CountdownOnCover e={e} />
          </div>
        ) : (
          <div className="flex gap-2 px-4 pt-3 empty:hidden">
            {hasCountdown(e) && <CountdownBadge startsAt={e.startsAt} design={e.design} />}
            <LiveNow startsAt={e.startsAt} endsAt={e.endsAt} cancelled={cancelled} />
          </div>
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
    </BurnFrame>
  );
}

/**
 * The event's name block over its cover photo — ministry, title, dates, place — as on the
 * event screen. The moving poster uses the same block, so both line up exactly.
 */
export function EventHeroText({ e }: { e: EventSummary }) {
  const t = useT();
  const when = useEventWhen();
  const cancelled = e.status === 'cancelled';
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold uppercase tracking-wider opacity-80">
          {e.groupName}
        </span>
        {cancelled && <Badge tone="danger">{t.events.cancelled}</Badge>}
      </div>
      <h1
        className={`mt-1 text-[26px] font-bold leading-tight tracking-tight ${cancelled ? 'line-through' : ''}`}
      >
        {e.title}
      </h1>
      <div className="mt-1.5 text-[15px] opacity-90">{when(e)}</div>
      {e.location && (
        <div className="mt-0.5 flex items-center gap-1.5 text-[15px] opacity-90">
          <IconMapPin size={16} className="shrink-0" /> {e.location}
        </div>
      )}
    </>
  );
}
