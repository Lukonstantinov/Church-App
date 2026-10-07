import { forwardRef } from 'react';
import {
  displayName,
  fontFamily,
  resolveBrand,
  type GroupSummary,
  type MeetingHelper,
  type MeetingRow,
  type PostDesign,
  type PosterLook,
  type Speaker,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { BackdropLayer, PatternLayer, onBrandStyle } from './PatternLayer';
import { SpeakerStrip } from './Speakers';

const TITLE_PX = { s: 32, m: 40, l: 50, xl: 60 } as const;

/** The poster's speakers: its own list, else the speakers from the meeting's people. */
export function posterSpeakers(m: { speakers?: Speaker[]; helpers?: MeetingHelper[] }): Speaker[] {
  if (m.speakers?.length) return m.speakers;
  return (m.helpers ?? [])
    .filter((h) => h.speaker)
    .slice(0, 4)
    .map((h) => ({
      name: displayName(h.person),
      role: h.role,
      mediaId: null,
      photoUrl: h.person.photoUrl ?? null,
    }));
}

/** The ministry's own look, for a poster that has none of its own. */
export const groupLook = (g: GroupSummary): PosterLook => ({
  brandColor: g.brandColor,
  pattern: g.pattern,
  textColor: g.textColor,
  logoUrl: g.logoUrl,
  backdrop: g.backdrop,
  backdropUrl: g.backdropUrl,
});

/**
 * A meeting poster in its own look (colours, pattern, photo, fonts — chosen like an
 * event's, else the ministry's) with the title, date, time, topic, place, leader and up
 * to four speakers. Rendered off screen and turned into an image to send with the bot
 * message; the same view is shown on the meeting screen.
 */
export const MeetingPoster = forwardRef<
  HTMLDivElement,
  {
    m: Pick<
      MeetingRow,
      'title' | 'startsAt' | 'endsAt' | 'topic' | 'location' | 'leader' | 'kind'
    > &
      Partial<{
        design: PostDesign | null;
        look: PosterLook | null;
        speakers: Speaker[];
        /** Speakers from the people list stand in when the poster has none of its own. */
        helpers: MeetingHelper[];
      }>;
    g: GroupSummary;
    /** Stamped "cancelled" across. */
    cancelled?: boolean;
  }
>(function MeetingPoster({ m, g, cancelled }, ref) {
  const t = useT();
  const f = useFmt();
  const look = m.look ?? groupLook(g);
  const design = m.design ?? null;
  const theme = resolveBrand(look.brandColor ?? 'blue');
  const on = onBrandStyle(look.textColor, true);
  const badge = f.dateBadge(m.startsAt);
  const center = design?.align === 'center';
  const speakers = posterSpeakers(m);
  const collage =
    design?.posterLayout === 'collage' ? speakers.filter((sp) => sp.photoUrl).slice(0, 4) : [];
  const place =
    design?.titlePos === 'top' ? 'mt-8' : design?.titlePos === 'center' ? 'my-auto' : 'mt-auto';
  return (
    <div
      ref={ref}
      className={`relative flex h-[675px] w-[540px] flex-col overflow-hidden p-10 ${on.className}`}
      style={{
        ...on.style,
        background: `linear-gradient(150deg, ${theme.light}, ${theme.partner})`,
        fontFamily: fontFamily(design?.bodyFont),
      }}
    >
      {collage.length > 0 ? (
        <div
          aria-hidden="true"
          className={`absolute inset-0 grid gap-1 ${collage.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${
            collage.length > 2 ? 'grid-rows-2' : ''
          }`}
        >
          {collage.map((sp, i) => (
            <img
              key={i}
              src={sp.photoUrl!}
              alt=""
              className={`h-full w-full object-cover ${collage.length === 3 && i === 0 ? 'row-span-2' : ''}`}
            />
          ))}
        </div>
      ) : (
        <>
          <PatternLayer pattern={look.pattern} logoUrl={look.logoUrl} />
          <BackdropLayer backdrop={look.backdrop} url={look.backdropUrl} />
        </>
      )}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent"
      />
      <div className={`relative flex items-center gap-3 ${center ? 'justify-center' : ''}`}>
        {look.logoUrl && (
          <img
            src={look.logoUrl}
            alt=""
            className="h-14 w-14 rounded-2xl bg-white object-contain p-1"
          />
        )}
        <span className="text-[20px] font-bold uppercase tracking-wider">{g.name}</span>
      </div>
      <div
        className={`relative flex flex-col gap-4 ${place} ${center ? 'items-center text-center' : ''}`}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-[96px] w-[96px] shrink-0 flex-col items-center justify-center rounded-3xl bg-white/22 backdrop-blur">
            <span className="text-[16px] font-bold uppercase">{badge.weekday}</span>
            <span className="text-[44px] font-extrabold leading-none">{badge.day}</span>
            <span className="text-[15px] font-semibold">{badge.month}</span>
          </div>
          <div className="min-w-0 text-left">
            <div
              className="font-extrabold leading-[1.05]"
              style={{
                fontSize: TITLE_PX[design?.titleSize ?? 'm'],
                fontFamily: fontFamily(design?.titleFont),
              }}
            >
              {m.title}
            </div>
            <div className="mt-1 text-[22px] font-semibold opacity-90">
              {f.timeRange(m.startsAt, m.endsAt)}
            </div>
          </div>
        </div>
        {m.topic && <div className="text-[28px] font-bold leading-tight">«{m.topic}»</div>}
        {speakers.length > 0 && (
          <SpeakerStrip
            speakers={collage.length ? speakers.map((sp) => ({ ...sp, photoUrl: null })) : speakers}
            size="md"
            onColor
          />
        )}
        <div
          className={`flex flex-wrap gap-2 text-[19px] font-semibold ${center ? 'justify-center' : ''}`}
        >
          {m.leader && (
            <span className="rounded-full bg-white px-4 py-1.5 text-[var(--brand)]">
              🎤 {displayName(m.leader)}
            </span>
          )}
          {m.kind && (
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
