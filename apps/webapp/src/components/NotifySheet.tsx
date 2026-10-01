import { useEffect, useRef, useState } from 'react';
import {
  displayName,
  MEDIA_MAX_BYTES,
  type GroupSummary,
  type MeetingPerson,
  type MeetingRow,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { fetchNotifyText, useNotifyMeeting, useUploadMedia } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { MeetingPoster } from './MeetingPoster';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Toggle } from './ui';

type Role = 'leader' | 'snack';

/**
 * Before messaging a meeting's leader or snack person: the notes (saved on the meeting),
 * the full message to read and change (or reset to the default), and the meeting poster.
 * Nothing is sent until "Send".
 */
export function NotifySheet({
  meeting,
  group,
  role,
  person,
  onClose,
}: {
  meeting: MeetingRow;
  group: GroupSummary | undefined;
  role: Role;
  person: MeetingPerson | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const notify = useNotifyMeeting();
  const upload = useUploadMedia(meeting.groupId, 'event');
  const poster = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState(meeting.notes ?? '');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [withPoster, setWithPoster] = useState(true);
  const [busy, setBusy] = useState<'poster' | 'send' | null>(null);

  const loadDefault = (n: string) => {
    setLoading(true);
    fetchNotifyText(meeting.id, role, n)
      .then((r) => setText(r.text))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let alive = true;
    fetchNotifyText(meeting.id, role, meeting.notes ?? '')
      .then((r) => alive && setText(r.text))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [meeting.id, role, meeting.notes]);

  if (!person) return null;

  async function posterImage(): Promise<number | null> {
    if (!withPoster || !poster.current || !group) return null;
    setBusy('poster');
    const { toJpeg } = await import('html-to-image');
    // Sharp enough for a phone, small enough for the upload limit.
    let blob: Blob | null = null;
    for (const [pixelRatio, quality] of [
      [2, 0.88],
      [2, 0.72],
      [1.5, 0.7],
      [1, 0.7],
    ] as const) {
      const dataUrl = await toJpeg(poster.current, { quality, pixelRatio, skipFonts: true });
      blob = await (await fetch(dataUrl)).blob();
      if (blob.size <= MEDIA_MAX_BYTES) break;
    }
    if (!blob || blob.size > MEDIA_MAX_BYTES) return null;
    const media = await upload.mutateAsync(blob);
    return media.id;
  }

  async function send() {
    try {
      const posterMediaId = await posterImage().catch(() => null);
      setBusy('send');
      const res = await notify.mutateAsync({
        id: meeting.id,
        role,
        notes: notes.trim() || null,
        text: text.trim() || undefined,
        posterMediaId,
      });
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
    } finally {
      setBusy(null);
    }
  }

  const field =
    'w-full resize-y rounded-xl bg-hairline px-3 py-2.5 text-[15px] leading-snug outline-none';
  return (
    <Sheet open onClose={onClose} title={t.meetings.messageTo(displayName(person))}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-hint">{t.meetings.notesForMessage}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            className={field}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-hint">{t.meetings.messageText}</span>
            <button
              type="button"
              onClick={() => loadDefault(notes.trim())}
              className="text-[13px] font-semibold text-link"
            >
              {t.meetings.resetText}
            </button>
          </div>
          <textarea
            value={loading ? '…' : text}
            onChange={(e) => setText(e.target.value)}
            maxLength={3000}
            rows={7}
            disabled={loading}
            className={field}
          />
        </div>
        {group && (
          <div className="overflow-hidden rounded-2xl ring-1 ring-hairline">
            <div className="px-1">
              <Toggle
                label={t.meetings.attachPoster}
                checked={withPoster}
                onChange={setWithPoster}
              />
            </div>
            {withPoster && (
              <div className="flex justify-center bg-hairline/50 py-3">
                {/* Shown at half size; captured at full size. */}
                <div className="h-[338px] w-[270px] overflow-hidden rounded-xl shadow-card">
                  <div className="origin-top-left scale-50">
                    <MeetingPoster ref={poster} m={meeting} g={group} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <Button disabled={loading || busy !== null || !text.trim()} onClick={() => void send()}>
          📨{' '}
          {busy === 'poster'
            ? t.meetings.preparing
            : busy === 'send'
              ? t.common.saving
              : t.meetings.sendMessage}
        </Button>
        <Button variant="glass" onClick={onClose}>
          {t.meetings.later}
        </Button>
      </div>
    </Sheet>
  );
}
