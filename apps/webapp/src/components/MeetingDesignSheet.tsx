import { useState } from 'react';
import type { GroupDetail, MeetingDetail } from '@church/shared';
import { useT } from '../lib/i18n';
import { useGroup, useMeeting, useUpdateMeeting } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { useCoverLook } from './CoverDesigner';
import {
  MeetingPosterDesigner,
  initMeetingPoster,
  meetingPosterPayload,
} from './MeetingPosterDesigner';
import { PeopleLookEditor } from './MeetingPeople';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Loading, Toggle } from './ui';

/**
 * «🎨 Оформление» of one meeting — the one place its look is changed: where each part comes
 * from (with a way back to the shared look), the layered poster, look and poster, speakers,
 * speaker photos, animations with their settings, and the people cards. Opened from the
 * meeting and from Design's list alike.
 */
export function MeetingDesignSheet({
  meetingId,
  onClose,
}: {
  meetingId: number;
  onClose: () => void;
}) {
  const t = useT();
  const meeting = useMeeting(meetingId);
  const group = useGroup(meeting.data?.groupId ?? 0);
  return (
    <Sheet open onClose={onClose} title={`🎨 ${t.design.sheetTitle}`}>
      {meeting.data && group.data ? (
        <Editor m={meeting.data} g={group.data} onClose={onClose} />
      ) : (
        <Loading />
      )}
    </Sheet>
  );
}

function Editor({ m, g, onClose }: { m: MeetingDetail; g: GroupDetail; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const update = useUpdateMeeting();
  const [state, setState] = useState(() => initMeetingPoster(m));
  const { templateId } = useCoverLook(state.cover, g, g.meetingTemplateId);
  const [toSeries, setToSeries] = useState(false);
  const [people, setPeople] = useState(false);
  async function save() {
    try {
      await update.mutateAsync({
        id: m.id,
        ...meetingPosterPayload(state, templateId),
        ...(toSeries ? { applyToSeries: true } : {}),
      });
      haptic.success();
      toast(t.common.saved);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <MeetingPosterDesigner
        g={g}
        groupId={m.groupId}
        meeting={m}
        state={state}
        onChange={setState}
        followTemplateId={g.meetingTemplateId}
        onPeopleLook={() => setPeople(true)}
      />
      {m.seriesId && (
        <Toggle label={t.meetings.applyToSeries} checked={toSeries} onChange={setToSeries} />
      )}
      <Button disabled={update.isPending} onClick={() => void save()}>
        {t.common.save}
      </Button>
      {people && <PeopleLookEditor m={m} onClose={() => setPeople(false)} />}
    </div>
  );
}
