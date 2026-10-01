import { useState } from 'react';
import { displayName, type MeetingPerson } from '@church/shared';
import { useT } from '../lib/i18n';
import { useNotifyMeeting } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button } from './ui';

/**
 * After choosing a leader or snack person: write notes for the meeting (saved on it)
 * and send them the bot message — or leave it for later. Nothing is sent by itself.
 */
export function NotifySheet({
  meetingId,
  role,
  person,
  notes,
  onClose,
}: {
  meetingId: number;
  role: 'leader' | 'snack';
  person: MeetingPerson | null;
  notes: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const notify = useNotifyMeeting();
  const [text, setText] = useState(notes ?? '');
  if (!person) return null;

  async function send() {
    try {
      const res = await notify.mutateAsync({ id: meetingId, role, notes: text.trim() || null });
      if (res.sent) {
        haptic.success();
        toast(t.meetings.messageSent);
        onClose();
      } else {
        haptic.error();
        toast(t.meetings.cantMessage, 'error');
      }
    } catch {
      toast(t.common.actionFailed, 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={t.meetings.messageTo(displayName(person))}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-hint">{t.meetings.notesForMessage}</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            rows={4}
            className="w-full resize-y rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none"
          />
        </label>
        <Button disabled={notify.isPending} onClick={() => void send()}>
          📨 {notify.isPending ? t.common.saving : t.meetings.sendMessage}
        </Button>
        <Button variant="glass" onClick={onClose}>
          {t.meetings.later}
        </Button>
      </div>
    </Sheet>
  );
}
