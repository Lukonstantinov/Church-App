import type { GroupSummary, MeetingHelper, MeetingMotion, MeetingRow } from '@church/shared';
import { Group, Pill } from './LookControls';
import { MotionPicker } from './MotionPicker';
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

/** Everything that makes up a meeting's poster: its look and its speakers. */
export interface MeetingPosterState {
  cover: CoverState;
  speakers: SpeakerDraft[];
  /** The poster's own animation (null = its template's, else none). */
  posterMotion: MeetingMotion | null;
  /** What it shows without one of its own (from the template). */
  inheritedMotion: MeetingMotion | null;
}

export const initMeetingPoster = (
  m?: Pick<
    MeetingRow,
    'design' | 'templateId' | 'look' | 'speakers' | 'posterMotion' | 'ownPosterMotion'
  >,
): MeetingPosterState => ({
  cover: initCover(m?.design, m?.templateId, m?.look, true),
  speakers: toDrafts(m?.speakers),
  posterMotion: m?.ownPosterMotion ?? null,
  inheritedMotion: m?.ownPosterMotion ? null : (m?.posterMotion ?? null),
});

/** The pieces the API stores for a meeting's poster. */
export function meetingPosterPayload(
  state: MeetingPosterState,
  templateId: number | null,
): {
  design: ReturnType<typeof coverPayload>['design'];
  templateId: number | null;
  speakers: ReturnType<typeof toSpeakerInputs>;
  posterMotion: MeetingMotion | null;
} {
  return {
    ...coverPayload(state.cover, templateId),
    speakers: toSpeakerInputs(state.speakers),
    posterMotion: state.posterMotion,
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
          <Group title={t.meetings.posterMotion}>
            <MotionPicker
              value={state.posterMotion}
              onChange={(posterMotion) => onChange({ ...state, posterMotion })}
              allowInherit
              inheritLabel={t.meetings.motionDefault}
            />
          </Group>
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
            value={state.cover.design.speakerLook}
            onChange={(speakerLook) => setDesign({ speakerLook })}
          />
        </div>
      </Section>
    </>
  );
}
