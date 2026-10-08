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
import { PosterPicker } from './PosterStudio';
import { usePosterTemplates } from '../lib/queries';
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
  /** A poster made of layers (Design → Posters) instead of the generated one. */
  posterTemplateId: number | null;
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
    | 'ownTemplateId'
    | 'posterTemplateId'
  >,
): MeetingPosterState => {
  const own = m?.ownMotionTunes ?? {};
  // What the template gives: the resolved settings without the meeting's own on top.
  const inherited = Object.fromEntries(
    Object.entries(m?.motionTunes ?? {}).filter(([k]) => !(k in own)),
  ) as MotionTunes;
  return {
    // Its own choice only: following the ministry's default shows as "as for all meetings".
    cover: initCover(m?.design, m?.ownTemplateId ?? null, m?.look, true),
    speakers: toDrafts(m?.speakers),
    posterMotion: m?.ownPosterMotion ?? null,
    inheritedMotion: m?.ownPosterMotion ? null : (m?.posterMotion ?? null),
    motion: m?.ownMotion ?? null,
    tileMotion: m?.ownTileMotion ?? null,
    motionTunes: own,
    inheritedTunes: inherited,
    inheritedSpeakerLook: m?.speakerLook ?? null,
    posterTemplateId: m?.posterTemplateId ?? null,
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
  posterTemplateId: number | null;
} {
  return {
    ...coverPayload(state.cover, templateId),
    speakers: toSpeakerInputs(state.speakers),
    posterMotion: state.posterMotion,
    motion: state.motion,
    tileMotion: state.tileMotion,
    motionTunes: state.motionTunes,
    posterTemplateId: state.posterTemplateId,
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
  followTemplateId,
  onPeopleLook,
}: {
  /** The ministry's default template for meetings ("as for all meetings"). */
  followTemplateId?: number | null;
  /** Opens the people block's look (cards, chips, icons), when the meeting exists. */
  onPeopleLook?: () => void;
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
  const { look, followed, templates } = useCoverLook(state.cover, g, followTemplateId);
  const posters = usePosterTemplates();
  const chosenPoster = posters.data?.find((x) => x.id === state.posterTemplateId) ?? null;
  const ownTpl =
    state.cover.source.kind === 'template'
      ? templates.find((x) => x.id === (state.cover.source as { id: number }).id)
      : null;
  // Where each part of the look comes from, with a way back to the default.
  const sources: { label: string; from: string; own: boolean; reset: () => void }[] = [
    {
      label: t.design.srcLook,
      from: ownTpl
        ? t.design.srcTemplate(ownTpl.name)
        : state.cover.source.kind === 'own'
          ? t.design.srcOwn
          : followed
            ? t.design.srcDefault(followed.name)
            : t.design.srcMinistry,
      own: state.cover.source.kind !== 'ministry' || !!state.cover.design.brandColor,
      reset: () =>
        onChange({
          ...state,
          cover: {
            ...state.cover,
            source: { kind: 'ministry' },
            design: { ...state.cover.design, brandColor: null },
          },
        }),
    },
    {
      label: t.design.srcMotions,
      from:
        state.motion ||
        state.tileMotion ||
        state.posterMotion ||
        Object.keys(state.motionTunes).length
          ? t.design.srcOwn
          : t.design.srcInherited,
      own: !!(
        state.motion ||
        state.tileMotion ||
        state.posterMotion ||
        Object.keys(state.motionTunes).length
      ),
      reset: () =>
        onChange({ ...state, motion: null, tileMotion: null, posterMotion: null, motionTunes: {} }),
    },
    {
      label: t.design.srcSpeakers,
      from: state.cover.design.speakerLook ? t.design.srcOwnChanges : t.design.srcInherited,
      own: !!state.cover.design.speakerLook,
      reset: () =>
        onChange({
          ...state,
          cover: { ...state.cover, design: { ...state.cover.design, speakerLook: null } },
        }),
    },
    {
      label: t.design.srcLayered,
      from: chosenPoster ? chosenPoster.name : t.posters.pickNone,
      own: !!chosenPoster,
      reset: () => onChange({ ...state, posterTemplateId: null }),
    },
  ];
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
                  speakerLook: { ...state.inheritedSpeakerLook, ...state.cover.design.speakerLook },
                  poster: chosenPoster,
                }}
                g={g}
              />
            </div>
          </div>
          <PosterPhotoWarning m={{ ...meeting, speakers: toShown(state.speakers) }} />
        </div>
      )}
      <Section title={t.design.srcTitle} footer={t.design.srcHint}>
        {sources.map((x) => (
          <div
            key={x.label}
            className="flex min-h-[52px] items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[15px]">{x.label}</div>
              <div className={`truncate text-[13px] ${x.own ? 'text-accent' : 'text-hint'}`}>
                {x.from}
              </div>
            </div>
            {x.own && (
              <button
                type="button"
                onClick={x.reset}
                className="shrink-0 rounded-full bg-hairline px-3 py-1.5 text-[13px] font-semibold active:scale-95"
              >
                ↺ {t.design.srcReset}
              </button>
            )}
          </div>
        ))}
        {onPeopleLook && (
          <button
            type="button"
            onClick={onPeopleLook}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left active:bg-hairline"
          >
            <span className="min-w-0 flex-1 text-[15px]">{t.design.srcPeople}</span>
            <span className="text-[13px] text-link">{t.design.srcOpen} ›</span>
          </button>
        )}
      </Section>
      <Section title={t.posters.pick} footer={t.posters.pickHint}>
        <div className="p-4">
          <PosterPicker
            value={state.posterTemplateId}
            onChange={(posterTemplateId) => onChange({ ...state, posterTemplateId })}
          />
        </div>
      </Section>
      <Section title={t.meetings.posterTitle} footer={t.meetings.posterHint}>
        <div className="flex flex-col gap-5 p-4">
          <CoverLookControls
            state={state.cover}
            onChange={(cover) => onChange({ ...state, cover })}
            g={g}
            groupId={groupId}
            followTemplateId={followTemplateId}
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
            // Shows what it follows; only what is changed here becomes its own.
            value={state.cover.design.speakerLook}
            base={state.inheritedSpeakerLook}
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
