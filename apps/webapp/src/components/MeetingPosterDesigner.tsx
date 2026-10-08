import { useState } from 'react';
import type {
  GroupSummary,
  MeetingHelper,
  MeetingMotion,
  MeetingRow,
  MotionTunes,
  SpeakerLook,
} from '@church/shared';
import { Pill } from './LookControls';
import { MotionTargets } from './MotionTargets';
import { useT } from '../lib/i18n';
import {
  CoverLookControls,
  TitleStyleControls,
  coverPayload,
  initCover,
  useCoverLook,
  type CoverState,
} from './CoverDesigner';
import { MeetingPoster, PosterPhotoWarning } from './MeetingPoster';
import {
  SpeakerLookControls,
  SpeakersEditor,
  toDrafts,
  toShown,
  toSpeakerInputs,
  type SpeakerDraft,
} from './Speakers';
import { Section } from './ui';

/** Everything that makes up a meeting's look: poster, speakers, animations and their settings. */
export interface MeetingPosterState {
  cover: CoverState;
  speakers: SpeakerDraft[];
  /** The poster's own animation (null = its template's, else none). */
  posterMotion: MeetingMotion | null;
  /** What it shows without one of its own (from the template). */
  inheritedMotion: MeetingMotion | null;
  /** Its own animations on its screen and home tile (null = the template's / ministry's). */
  motion: MeetingMotion | null;
  tileMotion: MeetingMotion | null;
  /** Its own settings per animation, and those it follows (its template's). */
  motionTunes: MotionTunes;
  inheritedTunes: MotionTunes;
  /** The speaker-photo look it follows without its own (its template's). */
  inheritedSpeakerLook: SpeakerLook | null;
}

export const initMeetingPoster = (
  m?: Pick<
    MeetingRow,
    | 'design'
    | 'templateId'
    | 'look'
    | 'speakers'
    | 'posterMotion'
    | 'ownPosterMotion'
    | 'ownMotion'
    | 'ownTileMotion'
    | 'motionTunes'
    | 'ownMotionTunes'
    | 'speakerLook'
  >,
): MeetingPosterState => {
  const own = m?.ownMotionTunes ?? {};
  // What the template gives: the resolved settings without the meeting's own on top.
  const inherited = Object.fromEntries(
    Object.entries(m?.motionTunes ?? {}).filter(([k]) => !(k in own)),
  ) as MotionTunes;
  return {
    cover: initCover(m?.design, m?.templateId, m?.look, true),
    speakers: toDrafts(m?.speakers),
    posterMotion: m?.ownPosterMotion ?? null,
    inheritedMotion: m?.ownPosterMotion ? null : (m?.posterMotion ?? null),
    motion: m?.ownMotion ?? null,
    tileMotion: m?.ownTileMotion ?? null,
    motionTunes: own,
    inheritedTunes: inherited,
    inheritedSpeakerLook: m?.design?.speakerLook ? null : (m?.speakerLook ?? null),
  };
};

/** The pieces the API stores for a meeting's look. */
export function meetingPosterPayload(
  state: MeetingPosterState,
  templateId: number | null,
): {
  design: ReturnType<typeof coverPayload>['design'];
  templateId: number | null;
  speakers: ReturnType<typeof toSpeakerInputs>;
  posterMotion: MeetingMotion | null;
  motion: MeetingMotion | null;
  tileMotion: MeetingMotion | null;
  motionTunes: MotionTunes;
} {
  return {
    ...coverPayload(state.cover, templateId),
    speakers: toSpeakerInputs(state.speakers),
    posterMotion: state.posterMotion,
    motion: state.motion,
    tileMotion: state.tileMotion,
    motionTunes: state.motionTunes,
  };
}

/**
 * Designs a meeting's poster like an event's: look (ministry's, own or a template),
 * colour, headline font, size and position, and up to four speakers with photos —
 * with a live preview of the poster itself.
 */
export function MeetingPosterDesigner({
  g,
  groupId,
  meeting,
  state,
  onChange,
}: {
  g: GroupSummary | undefined;
  groupId: number;
  /** What the poster shows (title, time, place…). */
  meeting: Pick<
    MeetingRow,
    'title' | 'startsAt' | 'endsAt' | 'topic' | 'location' | 'leader' | 'kind'
  > & { helpers?: MeetingHelper[] };
  state: MeetingPosterState;
  onChange: (s: MeetingPosterState) => void;
}) {
  const t = useT();
  const { look } = useCoverLook(state.cover, g);
  const [motionSlide, setMotionSlide] = useState(2);
  const setDesign = (patch: Partial<MeetingPosterState['cover']['design']>) =>
    onChange({ ...state, cover: { ...state.cover, design: { ...state.cover.design, ...patch } } });
  return (
    <>
      {g && (
        // Stays at the top while scrolling through the settings, so every change is seen.
        <div className="sticky top-0 z-20 -mx-4 flex flex-col items-center rounded-b-[22px] bg-[var(--color-section)] px-4 pb-3 pt-2 shadow-card">
          <div className="h-[257px] w-[205px] overflow-hidden rounded-xl shadow-card">
            <div className="origin-top-left scale-[0.38]">
              <MeetingPoster
                m={{
                  ...meeting,
                  look,
                  design: state.cover.design,
                  speakers: toShown(state.speakers),
                  posterMotion: state.posterMotion ?? state.inheritedMotion,
                  motionTunes: { ...state.inheritedTunes, ...state.motionTunes },
                  speakerLook: state.inheritedSpeakerLook,
                }}
                g={g}
              />
            </div>
          </div>
          <PosterPhotoWarning m={{ ...meeting, speakers: toShown(state.speakers) }} />
        </div>
      )}
      <Section title={t.meetings.posterTitle} footer={t.meetings.posterHint}>
        <div className="flex flex-col gap-5 p-4">
          <CoverLookControls
            state={state.cover}
            onChange={(cover) => onChange({ ...state, cover })}
            g={g}
            groupId={groupId}
          />
          <div>
            <div className="mb-2 text-[13px] text-hint">{t.meetings.posterLayout}</div>
            <div className="flex flex-wrap gap-2">
              {(['classic', 'collage'] as const).map((l) => (
                <Pill
                  key={l}
                  on={(state.cover.design.posterLayout ?? 'classic') === l}
                  onClick={() => setDesign({ posterLayout: l })}
                  label={l === 'classic' ? t.meetings.layoutClassic : t.meetings.layoutCollage}
                />
              ))}
            </div>
          </div>
          <TitleStyleControls design={state.cover.design} set={setDesign} />
        </div>
      </Section>
      <Section title={t.meetings.speakers}>
        <SpeakersEditor
          groupId={groupId}
          value={state.speakers}
          onChange={(speakers) => onChange({ ...state, speakers })}
        />
      </Section>
      <Section title={t.meetings.speakerLook}>
        <div className="p-4">
          <SpeakerLookControls
            // Without its own, it starts from what the template gives.
            value={state.cover.design.speakerLook ?? state.inheritedSpeakerLook}
            onChange={(speakerLook) => setDesign({ speakerLook })}
          />
        </div>
      </Section>
      <Section title={t.meetings.meetingMotions} footer={t.meetings.meetingMotionsHint}>
        <div className="p-4">
          <MotionTargets
            slide={motionSlide}
            onSlide={setMotionSlide}
            screen={{
              value: state.motion,
              set: (motion) => onChange({ ...state, motion }),
              inherit: t.meetings.motionMinistry,
            }}
            tile={{
              value: state.tileMotion,
              set: (tileMotion) => onChange({ ...state, tileMotion }),
              inherit: t.meetings.motionDefault,
            }}
            poster={{
              value: state.posterMotion,
              set: (posterMotion) => onChange({ ...state, posterMotion }),
              inherit: t.meetings.motionDefault,
            }}
            tunes={{
              value: state.motionTunes,
              inherited: state.inheritedTunes,
              set: (motionTunes) => onChange({ ...state, motionTunes }),
            }}
          />
        </div>
      </Section>
    </>
  );
}
