import type { GroupSummary, MeetingRow } from '@church/shared';
import { useT } from '../lib/i18n';
import {
  CoverLookControls,
  TitleStyleControls,
  coverPayload,
  initCover,
  useCoverLook,
  type CoverState,
} from './CoverDesigner';
import { MeetingPoster } from './MeetingPoster';
import { SpeakersEditor, toDrafts, toShown, toSpeakerInputs, type SpeakerDraft } from './Speakers';
import { Section } from './ui';

/** Everything that makes up a meeting's poster: its look and its speakers. */
export interface MeetingPosterState {
  cover: CoverState;
  speakers: SpeakerDraft[];
}

export const initMeetingPoster = (
  m?: Pick<MeetingRow, 'design' | 'templateId' | 'look' | 'speakers'>,
): MeetingPosterState => ({
  cover: initCover(m?.design, m?.templateId, m?.look, true),
  speakers: toDrafts(m?.speakers),
});

/** The pieces the API stores for a meeting's poster. */
export function meetingPosterPayload(
  state: MeetingPosterState,
  templateId: number | null,
): {
  design: ReturnType<typeof coverPayload>['design'];
  templateId: number | null;
  speakers: ReturnType<typeof toSpeakerInputs>;
} {
  return { ...coverPayload(state.cover, templateId), speakers: toSpeakerInputs(state.speakers) };
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
  >;
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
        <div className="flex justify-center">
          <div className="h-[338px] w-[270px] overflow-hidden rounded-xl shadow-card">
            <div className="origin-top-left scale-50">
              <MeetingPoster
                m={{
                  ...meeting,
                  look,
                  design: state.cover.design,
                  speakers: toShown(state.speakers),
                }}
                g={g}
              />
            </div>
          </div>
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
    </>
  );
}
