import { useMemo, useState } from 'react';
import {
  displayName,
  type GroupSummary,
  type PosterLook,
  type Speaker,
  type SpeakerLook,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useMembers } from '../lib/queries';
import { LookTop } from './LookTop';
import { CardSpeaker, MeetingPoster, groupLook } from './MeetingPoster';
import { DateBadge } from './ui';

/**
 * A sample meeting wearing a speaker-photo look: its poster and its home tile, side by
 * side. The speaker is someone from the ministry who has a profile photo (else initials).
 */
export function SpeakerLookPreview({
  look,
  g,
  colors,
}: {
  look: SpeakerLook | null;
  g: GroupSummary;
  /** The colours to show it in (a template's); default the ministry's. */
  colors?: PosterLook;
}) {
  const t = useT();
  const f = useFmt();
  const members = useMembers(g.id);
  // A sample date four days ahead at 19:00, fixed while the screen is open.
  const [when] = useState(() => {
    const d = new Date(Date.now() + 4 * 86_400_000);
    d.setHours(19, 0, 0, 0);
    return { startsAt: d.toISOString(), endsAt: new Date(d.getTime() + 7_200_000).toISOString() };
  });
  const sample = useMemo((): Speaker => {
    const m = members.data?.find((x) => x.photoUrl) ?? members.data?.[0];
    return {
      name: m ? displayName(m) : t.meetings.leader,
      role: t.meetings.leader,
      mediaId: null,
      userId: m?.userId ?? null,
      photoUrl: m?.photoUrl ?? null,
    };
  }, [members.data, t]);
  const tint = colors ?? groupLook(g);
  const meeting = {
    title: t.design.sampleTitle,
    ...when,
    topic: t.design.sampleTopic,
    location: t.design.sampleLocation,
    leader: null,
    kind: null,
    look: tint,
    design: { banner: true, speakerLook: look },
    speakers: [sample],
    speakerLook: look,
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-center gap-3">
        <div className="h-[216px] w-[173px] shrink-0 overflow-hidden rounded-xl shadow-card">
          <div className="pointer-events-none origin-top-left scale-[0.32]">
            <MeetingPoster m={meeting} g={g} />
          </div>
        </div>
        <div className="glass flex w-[138px] shrink-0 flex-col overflow-hidden rounded-2xl shadow-card">
          <LookTop
            look={tint}
            className="isolate flex aspect-[16/10] flex-col justify-between p-2"
            under={<CardSpeaker m={meeting} />}
          >
            <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">
              {t.meetings.details}
            </span>
            <span className="origin-bottom-left scale-75">
              <DateBadge {...f.dateBadge(when.startsAt)} onBrand />
            </span>
          </LookTop>
          <div className="flex flex-col p-2">
            <span className="truncate text-[12px] font-semibold">{meeting.title}</span>
            <span className="truncate text-[11px] text-hint">{f.time(when.startsAt)}</span>
          </div>
        </div>
      </div>
      {!sample.photoUrl && (
        <p className="text-center text-[12px] text-[#d97706]">{t.design.speakerPreviewNoPhoto}</p>
      )}
    </div>
  );
}
