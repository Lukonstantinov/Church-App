import { forwardRef } from 'react';
import {
  displayName,
  fontFamily,
  resolveBrand,
  speakerSpot,
  type GroupSummary,
  type MeetingHelper,
  type MeetingPerson,
  type MeetingMotion,
  type PosterTemplate,
  type MeetingRow,
  type PostDesign,
  type PosterLook,
  type Speaker,
  type SpeakerLook,
  type MotionTunes,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { BackdropLayer, PatternLayer, onBrandStyle } from './PatternLayer';
import { LivingLayer } from './ui';
import { LayeredPoster, usePosterTexts } from './LayeredPoster';
import { SpeakerBackdrop, SpeakerStrip, leadPhoto, withoutPhoto } from './Speakers';

const TITLE_PX = { s: 32, m: 40, l: 50, xl: 60 } as const;

/**
 * The poster's speakers: its own list, else the speakers from the meeting's people, else
 * its leader (labelled `leaderRole`) — each with their profile photo.
 */
export function posterSpeakers(
  m: { speakers?: Speaker[]; helpers?: MeetingHelper[]; leader?: MeetingPerson | null },
  leaderRole?: string,
): Speaker[] {
  if (m.speakers?.length) return m.speakers;
  const helpers = (m.helpers ?? [])
    .filter((h) => h.speaker)
    .slice(0, 4)
    .map((h) => ({
      name: displayName(h.person),
      role: h.role,
      mediaId: null,
      userId: h.person.id,
      photoUrl: h.person.photoUrl ?? null,
    }));
  if (helpers.length || !leaderRole || !m.leader) return helpers;
  return [
    {
      name: displayName(m.leader),
      role: leaderRole,
      mediaId: null,
      userId: m.leader.id,
      photoUrl: m.leader.photoUrl ?? null,
    },
  ];
}

/** The names on a generated poster that will show initials (no photo): a warning to show. */
export function posterMissingPhotos(
  m: Parameters<typeof posterSpeakers>[0] & { poster?: PosterTemplate | null },
  leaderRole: string,
): string[] {
  if (m.poster) return [];
  return withoutPhoto(posterSpeakers(m, leaderRole));
}

/**
 * The speaker's photo on a meeting's cards (home tile, "next meeting" panel, its screen):
 * filling the side (or the whole background) and fading into the card. Off when the
 * design says so, or with a poster template.
 */
export function CardSpeaker({
  m,
}: {
  m: Parameters<typeof posterSpeakers>[0] & {
    speakerLook?: SpeakerLook | null;
    poster?: PosterTemplate | null;
  };
}) {
  const t = useT();
  const look = m.speakerLook ?? null;
  if (m.poster || look?.onCards === false) return null;
  const url = leadPhoto(posterSpeakers(m, t.meetings.leader));
  if (!url) return null;
  const whole = look?.style === 'background';
  return (
    <SpeakerBackdrop
      url={url}
      look={{
        style: whole ? 'background' : 'side',
        place: 'free',
        x: look?.style === 'side' && look.x ? look.x : 'right',
        // Faces are usually near the top of a photo.
        y: look?.y ?? 'top',
        opacity: look?.style && look.style !== 'photo' ? look.opacity : undefined,
      }}
    />
  );
}

/** A note under a poster preview when a speaker will show initials instead of a photo. */
export function PosterPhotoWarning({ m }: { m: Parameters<typeof posterMissingPhotos>[0] }) {
  const t = useT();
  const names = posterMissingPhotos(m, t.meetings.leader);
  if (!names.length) return null;
  return (
    <p className="px-3 py-2 text-center text-[12px] leading-snug text-[#d97706]">
      {t.meetings.posterNoPhotos(names.join(', '))}
    </p>
  );
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
        /** The poster's animation (the sent picture keeps one still frame of it). */
        posterMotion: MeetingMotion | null;
        /** A poster template (Design → Posters): drawn instead of the usual poster. */
        poster: PosterTemplate | null;
        /** How speakers' photos show when the design has no setting of its own (its template's). */
        speakerLook: SpeakerLook | null;
        /** Settings per animation (the poster's animation uses its own). */
        motionTunes: MotionTunes;
      }>;
    g: GroupSummary;
    /** Stamped "cancelled" across. */
    cancelled?: boolean;
    /**
     * Without its texts (ministry, date, title, topic, people, place): just the picture,
     * the speakers' photos and the animation — for a moving poster with own words or none.
     */
    bare?: boolean;
    /** Drawn over the poster (own words on a moving poster). */
    children?: React.ReactNode;
  }
>(function MeetingPoster({ m, g, cancelled, bare, children }, ref) {
  const t = useT();
  const f = useFmt();
  const posterTexts = usePosterTexts();
  const look = m.look ?? groupLook(g);
  const design = m.design ?? null;
  const theme = resolveBrand(look.brandColor ?? 'blue');
  const on = onBrandStyle(look.textColor, true);
  const badge = f.dateBadge(m.startsAt);
  const center = design?.align === 'center';
  const speakers = posterSpeakers(m, t.meetings.leader);
  // The leader already shows as the speaker (with photo): no second pill for them.
  const leaderSpeaks = !!m.leader && speakers.some((sp) => sp.userId === m.leader!.id);
  const collage =
    design?.posterLayout === 'collage' ? speakers.filter((sp) => sp.photoUrl).slice(0, 4) : [];
  const place =
    design?.titlePos === 'top' ? 'mt-8' : design?.titlePos === 'center' ? 'my-auto' : 'mt-auto';
  // The speakers' photos: how they look (this poster's own setting, else its template's).
  // Its own changes over what it follows, field by field.
  const speakerLook =
    design?.speakerLook || m.speakerLook ? { ...m.speakerLook, ...design?.speakerLook } : null;
  const style = speakerLook?.style ?? 'photo';
  const spot = speakerSpot(speakerLook);
  const backdropPhoto = style !== 'photo' && !collage.length ? leadPhoto(speakers) : null;
  const strip = (className?: string, vertical?: boolean, side?: 'left' | 'right') => (
    <SpeakerStrip
      speakers={collage.length ? speakers.map((sp) => ({ ...sp, photoUrl: null })) : speakers}
      size="md"
      onColor
      look={speakerLook}
      brand={theme.light}
      vertical={vertical}
      side={side}
      className={className}
    />
  );
  // Photos at one of nine spots (over the poster), or with the text.
  const placed =
    speakers.length > 0 && style === 'photo' && !spot.inline ? (
      <div
        className={`absolute flex ${
          spot.x === 'left'
            ? 'left-10'
            : spot.x === 'right'
              ? 'right-10'
              : 'inset-x-10 justify-center'
        } ${
          spot.y === 'top'
            ? // On the right it lines up with the logo row; elsewhere it sits just under it.
              spot.x === 'right' && !center
              ? 'top-10'
              : 'top-28'
            : spot.y === 'bottom'
              ? // Its bottom edge on the same line as the title block's last line.
                'bottom-10'
              : 'top-1/2 -translate-y-1/2'
        }`}
      >
        {strip(undefined, spot.x !== 'center', spot.x === 'center' ? undefined : spot.x)}
      </div>
    ) : null;
  if (m.poster)
    return (
      <div ref={ref} className="relative h-[675px] w-[540px] overflow-hidden">
        <LayeredPoster fill tpl={m.poster} texts={posterTexts({ ...m, topic: m.topic })} />
        {children}
        {cancelled && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
            <span className="-rotate-12 rounded-2xl border-[6px] border-[#ef4444] bg-white/90 px-8 py-3 text-[56px] font-black tracking-widest text-[#ef4444]">
              {t.meetings.cancelledStamp}
            </span>
          </div>
        )}
      </div>
    );
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
              data-shot="under"
              className={`h-full w-full object-cover ${collage.length === 3 && i === 0 ? 'row-span-2' : ''}`}
            />
          ))}
        </div>
      ) : (
        <>
          <PatternLayer pattern={look.pattern} logoUrl={look.logoUrl} />
          <BackdropLayer backdrop={look.backdrop} url={look.backdropUrl} />
          {backdropPhoto && <SpeakerBackdrop url={backdropPhoto} look={speakerLook} />}
        </>
      )}
      {/* Drawn at print size, so its particles are drawn larger. */}
      {m.posterMotion && m.posterMotion !== 'off' && (
        <LivingLayer
          kind={m.posterMotion}
          tune={{
            ...m.motionTunes?.[m.posterMotion],
            size: (m.motionTunes?.[m.posterMotion]?.size ?? 1) * 1.6,
          }}
        />
      )}
      {!bare && (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent"
        />
      )}
      {!bare && (
        <div className={`relative flex items-center gap-3 ${center ? 'justify-center' : ''}`}>
          {look.logoUrl && (
            <img
              src={look.logoUrl}
              alt=""
              data-shot="top"
              className="h-14 w-14 rounded-2xl bg-white object-contain p-1"
            />
          )}
          <span className="text-[20px] font-bold uppercase tracking-wider">{g.name}</span>
        </div>
      )}

      {!bare && (
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
          {speakers.length > 0 && style === 'photo' && spot.inline && strip()}
          {/* With the photo in the background, the names go with the text. */}
          {style !== 'photo' && speakers.length > 0 && (
            <div className={`flex flex-wrap gap-2 ${center ? 'justify-center' : ''}`}>
              {speakers.map((sp, i) => (
                <span
                  key={`${sp.name}${i}`}
                  className="rounded-full bg-white px-4 py-1.5 text-[19px] font-semibold text-[var(--brand)]"
                >
                  🎤 {sp.name}
                  {sp.role ? <span className="opacity-70"> · {sp.role}</span> : null}
                </span>
              ))}
            </div>
          )}
          <div
            className={`flex flex-wrap gap-2 text-[19px] font-semibold ${center ? 'justify-center' : ''}`}
          >
            {m.leader && !leaderSpeaks && (
              <span className="rounded-full bg-white px-4 py-1.5 text-[var(--brand)]">
                🎤 {displayName(m.leader)}
              </span>
            )}
            {m.kind && (
              <span className="rounded-full bg-white/22 px-4 py-1.5">
                {t.meetings.kinds[m.kind]}
              </span>
            )}
            {m.location && (
              <span className="rounded-full bg-white/22 px-4 py-1.5">📍 {m.location}</span>
            )}
          </div>
        </div>
      )}
      {placed}
      {children}
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
