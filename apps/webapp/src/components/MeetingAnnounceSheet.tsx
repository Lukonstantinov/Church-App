import { useEffect, useRef, useState } from 'react';
import {
  displayName,
  type GroupSummary,
  type MeetingNotice,
  type MeetingRow,
} from '@church/shared';
import { useT } from '../lib/i18n';
import { capturePoster } from '../lib/poster';
import {
  fetchMeetingAnnounceText,
  useAnnounceMeeting,
  useMe,
  useMembers,
  uploadLoop,
  useRequestAnnounceMeeting,
  useTestAnnounceMeeting,
  useUploadMedia,
} from '../lib/queries';
import { haptic } from '../lib/telegram';
import {
  AudienceChoice,
  audienceEmpty,
  audienceIds,
  type Audience,
  type AudiencePreset,
} from './AudienceChoice';
import { IconCheck, IconSend } from './icons';
import { MeetingPoster, PosterPhotoWarning } from './MeetingPoster';
import { MotionExport } from './MotionExport';
import { FullMotion } from '../lib/perf';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Switch, Toggle } from './ui';

/**
 * Tell the ministry about a meeting: the message (who leads, the topic, when and where)
 * to read and change, the meeting poster on or off, and who gets it — everyone it is for,
 * the leaders, or chosen people. They see who sent it. Anyone preparing it can send a test
 * to themselves first; a designer who may not send it to everyone hands it in for approval.
 */
export function MeetingAnnounceSheet({
  meeting,
  group,
  onClose,
  notice = 'announce',
  previousStartsAt,
  canPublish = true,
}: {
  meeting: MeetingRow;
  group: GroupSummary | undefined;
  onClose: () => void;
  /** About the meeting, its changed time, or its cancellation. */
  notice?: MeetingNotice;
  /** For a changed time: when it was. */
  previousStartsAt?: string | null;
  /** May send it to everyone (else: test and send for approval). */
  canPublish?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const members = useMembers(meeting.groupId);
  const announce = useAnnounceMeeting();
  const test = useTestAnnounceMeeting();
  const request = useRequestAnnounceMeeting();
  const upload = useUploadMedia(meeting.groupId, 'event');
  const poster = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [withPoster, setWithPoster] = useState(notice !== 'cancelled');
  // A leaders' meeting (or one for chosen people) asks who will come by default.
  const [ask, setAsk] = useState(notice !== 'cancelled' && meeting.audience !== null);
  const [audience, setAudience] = useState<Audience>({ kind: 'all', chosen: [] });
  const [busy, setBusy] = useState<'poster' | 'send' | 'test' | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [requested, setRequested] = useState<number | null>(null);
  // Recording the moving poster: its effects run in full whatever the phone's setting.
  const [recording, setRecording] = useState(false);
  // Send the poster moving (with its effects) instead of a still picture.
  const [animated, setAnimated] = useState(false);
  const [recordProgress, setRecordProgress] = useState<number | null>(null);

  const leaders = (members.data ?? [])
    .filter((m) => m.status === 'active' && m.role === 'leader')
    .map((m) => m.userId);
  const presets: AudiencePreset[] = [
    {
      key: 'all',
      label: meeting.audience ? t.meetings.meetingFor : t.meetings.everyone,
      ids: meeting.audience ?? null,
    },
    ...(members.data ? [{ key: 'leaders', label: t.meetings.leadersOnly, ids: leaders }] : []),
  ];

  const load = () => {
    setLoading(true);
    fetchMeetingAnnounceText(meeting.id, notice, previousStartsAt)
      .then((r) => setText(r.text))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let alive = true;
    fetchMeetingAnnounceText(meeting.id, notice, previousStartsAt)
      .then((r) => alive && setText(r.text))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [meeting.id, notice, previousStartsAt]);

  async function posterId(): Promise<number | null> {
    if (!withPoster || !poster.current) return null;
    setBusy('poster');
    // The moving poster: recorded as a loop (it plays like a GIF in Telegram). A phone that
    // can't make videos, or a poster without effects, sends the still picture.
    if (animated) {
      setRecording(true);
      try {
        await new Promise((r) => setTimeout(r, 400));
        const { hasEffects, recordLoop } = await import('../lib/recorder');
        if (hasEffects(poster.current)) {
          const rec = await recordLoop(poster.current, {
            quality: 0.09,
            onProgress: setRecordProgress,
          });
          if (rec.mp4) return (await uploadLoop(meeting.groupId, rec.mp4)).id;
        }
      } catch (err) {
        console.warn('moving poster failed', err);
      } finally {
        setRecording(false);
        setRecordProgress(null);
      }
    }
    const blob = await capturePoster(poster.current, true);
    if (!blob) return null;
    return (await upload.mutateAsync(blob)).id;
  }

  /** Sends it to everyone, only to oneself (a test), or for approval. */
  async function run(mode: 'send' | 'test' | 'request') {
    try {
      const posterMediaId = await posterId().catch(() => null);
      setBusy(mode === 'test' ? 'test' : 'send');
      const input = {
        id: meeting.id,
        notice,
        ask: notice !== 'cancelled' && ask,
        previousStartsAt: previousStartsAt ?? null,
        text: text.trim() || undefined,
        userIds: audienceIds(audience, presets),
        posterMediaId,
      };
      if (mode === 'test') {
        const res = await test.mutateAsync(input);
        if (res.sent === 0) throw new Error('unreachable');
        haptic.success();
        toast(t.publish.testSent);
        return;
      }
      if (mode === 'request') {
        const res = await request.mutateAsync(input);
        haptic.success();
        toast(t.publish.requested(res.asked));
        setRequested(res.asked);
        return;
      }
      const res = await announce.mutateAsync(input);
      if (res.sent === 0) {
        haptic.error();
        toast(t.events.remindNobody, 'error');
        return;
      }
      haptic.success();
      toast(t.events.remindSent(res.sent));
      setDone(res.sent);
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    } finally {
      setBusy(null);
    }
  }

  const field =
    'w-full resize-y rounded-xl bg-hairline px-3 py-2.5 text-[15px] leading-snug outline-none';
  return (
    <Sheet
      open
      onClose={onClose}
      title={
        notice === 'cancelled'
          ? t.meetings.noticeCancelled
          : notice === 'changed'
            ? t.meetings.noticeChanged
            : t.meetings.announceMeeting
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[13px] leading-snug text-hint">
          {notice === 'cancelled'
            ? t.meetings.cancelledAsk
            : notice === 'changed'
              ? t.meetings.timeChangedAsk
              : t.meetings.announceMeetingHint}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-hint">{t.events.remindText}</span>
          <button type="button" onClick={load} className="text-[13px] font-semibold text-link">
            {t.meetings.resetText}
          </button>
        </div>
        <textarea
          value={loading ? '…' : text}
          onChange={(e) => setText(e.target.value)}
          maxLength={3000}
          rows={8}
          disabled={loading}
          className={field}
        />
        {me.data && (
          <p className="-mt-1 text-[12px] text-hint">
            {t.meetings.signatureHint} <i>{t.bot.sentBy(displayName(me.data.user))}</i>
          </p>
        )}
        {group && (
          <div className="overflow-hidden rounded-2xl ring-1 ring-hairline">
            <div className="px-1">
              <Toggle label={t.events.withPoster} checked={withPoster} onChange={setWithPoster} />
            </div>
            {withPoster && (
              <div className="flex justify-center bg-hairline/50 py-3">
                {/* Shown at half size; captured at full size. */}
                <div className="h-[338px] w-[270px] overflow-hidden rounded-xl shadow-card">
                  <div className="origin-top-left scale-50">
                    <FullMotion.Provider value={recording}>
                      <MeetingPoster
                        ref={poster}
                        m={meeting}
                        g={group}
                        cancelled={notice === 'cancelled'}
                      />
                    </FullMotion.Provider>
                  </div>
                </div>
              </div>
            )}
            {withPoster && <PosterPhotoWarning m={meeting} />}
            {withPoster && notice !== 'cancelled' && (
              <div className="px-1">
                <Toggle
                  label={t.motionExport.sendMoving}
                  checked={animated}
                  onChange={setAnimated}
                />
                <p className="-mt-1 px-4 pb-2 text-[12px] leading-snug text-hint">
                  {t.motionExport.sendMovingHint}
                </p>
              </div>
            )}
            {withPoster && notice !== 'cancelled' && (
              <div className="px-3 pb-3">
                <MotionExport
                  node={poster}
                  name={meeting.title}
                  caption={text.trim() || meeting.title}
                  onRecording={setRecording}
                  share={
                    canPublish
                      ? { kind: 'meeting', id: meeting.id, groupId: meeting.groupId }
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        )}
        {notice !== 'cancelled' && (
          <button
            type="button"
            role="switch"
            aria-checked={ask}
            onClick={() => setAsk(!ask)}
            className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left ring-1 ring-hairline"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{t.meetings.askRsvp}</span>
              <span className="block text-[12px] text-hint">{t.meetings.askRsvpHint}</span>
            </span>
            <Switch on={ask} />
          </button>
        )}
        <AudienceChoice
          groupId={meeting.groupId}
          presets={presets}
          value={audience}
          onChange={setAudience}
        />
        {!canPublish && (
          <p className="text-[13px] leading-snug text-hint">{t.publish.designerHint}</p>
        )}
        {done !== null || requested !== null ? (
          <div className="flex items-center justify-center gap-1.5 py-2 text-[15px] font-semibold text-present">
            <IconCheck size={18} />{' '}
            {done !== null ? t.events.remindSent(done) : t.publish.requested(requested ?? 0)}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              disabled={loading || busy !== null || !text.trim()}
              onClick={() => void run('test')}
            >
              {busy === 'test' || (busy === 'poster' && recordProgress !== null)
                ? recordProgress !== null
                  ? t.motionExport.recording(Math.round(recordProgress * 100))
                  : t.meetings.preparing
                : t.publish.testSend}
            </Button>
            <Button
              disabled={
                loading || busy !== null || !text.trim() || audienceEmpty(audience, presets)
              }
              onClick={() => void run(canPublish ? 'send' : 'request')}
            >
              <IconSend size={16} />{' '}
              {recordProgress !== null
                ? t.motionExport.recording(Math.round(recordProgress * 100))
                : busy === 'poster'
                  ? t.meetings.preparing
                  : busy === 'send'
                    ? t.common.saving
                    : canPublish
                      ? t.events.remindSend
                      : t.publish.request}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
