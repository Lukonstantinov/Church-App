import { useEffect, useRef, useState } from 'react';
import { displayName } from '@church/shared';
import { useT } from '../lib/i18n';
import {
  fetchReminderText,
  useEvent,
  useMe,
  useRemindEvent,
  useRequestRemindEvent,
  useTestRemindEvent,
} from '../lib/queries';
import { recordPosterVideo } from '../lib/movingPoster';
import { haptic } from '../lib/telegram';
import {
  EventMotionPoster,
  LivePreview,
  NoMotionPrompt,
  eventMoves,
  eventPosterModes,
  useEventPosterText,
} from './MotionExport';
import { useNav } from '../lib/nav';
import { PosterTextControls, posterText, type PosterTextValue } from './PosterText';
import {
  AudienceChoice,
  audienceEmpty,
  audienceIds,
  type Audience,
  type AudiencePreset,
} from './AudienceChoice';
import { IconCheck, IconSend } from './icons';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Toggle } from './ui';

/**
 * Remind people about an event: read and change the text, pick who gets it (everyone,
 * those who serve, those who are going, or chosen people) and send. They see who sent it.
 * A test goes to oneself first; a designer who may not send it hands it in for approval.
 */
export function EventReminderSheet({
  eventId,
  groupId,
  title,
  onClose,
}: {
  eventId: number;
  groupId: number;
  title: string;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const detail = useEvent(eventId);
  const remind = useRemindEvent();
  const test = useTestRemindEvent();
  const request = useRequestRemindEvent();
  const canPublish = detail.data?.canPublish ?? true;
  const [requested, setRequested] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState<Audience>({ kind: 'all', chosen: [] });
  const [done, setDone] = useState<number | null>(null);
  const [withRoster, setWithRoster] = useState(false);
  const picture = detail.data?.botPictureUrl ?? null;
  // The picture with the message: none, the poster, or the poster moving (recorded now).
  const moves = !!detail.data && eventMoves(detail.data);
  const { push } = useNav();
  const [pic, setPic] = useState<'none' | 'still' | 'moving' | null>(null);
  const shown = pic ?? (picture ? 'still' : 'none');
  const movingNode = useRef<HTMLDivElement>(null);
  const modes = detail.data ? eventPosterModes(detail.data) : (['custom', 'none'] as const);
  const [style, setStyle] = useState<PosterTextValue | null>(null);
  const [ownWords, setOwnWords] = useState<string | null>(null);
  const posterWords = useEventPosterText();
  const preset = detail.data ? posterWords(detail.data) : '';
  const words: PosterTextValue = {
    ...(style ?? posterText('', modes[0])),
    text: ownWords ?? preset,
  };
  const [recording, setRecording] = useState<number | null>(null);

  const serving = [
    ...new Set((detail.data?.roles ?? []).flatMap((r) => r.assignees.map((a) => a.id))),
  ];
  const going = (detail.data?.rsvps.going ?? []).map((p) => p.id);
  const presets: AudiencePreset[] = [
    { key: 'all', label: t.events.remindEveryone, ids: null },
    ...(detail.data && detail.data.roles.length > 0
      ? [{ key: 'serving', label: t.events.remindServing, ids: serving }]
      : []),
    ...(detail.data?.features.rsvp
      ? [{ key: 'going', label: t.events.remindGoing, ids: going }]
      : []),
  ];

  const load = () => {
    setLoading(true);
    fetchReminderText(eventId)
      .then((r) => setText(r.text))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let alive = true;
    fetchReminderText(eventId)
      .then((r) => alive && setText(r.text))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [eventId]);

  /** Sends it to everyone, only to oneself (a test), or for approval. */
  async function run(mode: 'send' | 'test' | 'request') {
    try {
      // The moving poster is recorded now and stored for the ministry; a phone that can't
      // make videos sends the still poster.
      let posterMediaId: number | null = null;
      if (shown === 'moving' && movingNode.current) {
        setRecording(0);
        try {
          await new Promise((r) => setTimeout(r, 300));
          posterMediaId = await recordPosterVideo(movingNode.current, groupId, setRecording);
          if (!posterMediaId) toast(t.motionExport.noVideo);
        } finally {
          setRecording(null);
        }
      }
      const input = {
        id: eventId,
        text: text.trim() || undefined,
        userIds: audienceIds(audience, presets),
        roster: withRoster,
        poster: shown !== 'none' && (!!posterMediaId || !!picture),
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
      const res = await remind.mutateAsync(input);
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
    }
  }

  const field =
    'w-full resize-y rounded-xl bg-hairline px-3 py-2.5 text-[15px] leading-snug outline-none';
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-hint">{t.events.remindText}</span>
          <button type="button" onClick={load} className="text-[13px] font-semibold text-link">
            {t.meetings.resetText}
          </button>
        </div>
        <textarea
          value={loading ? '…' : text}
          onChange={(ev) => setText(ev.target.value)}
          maxLength={3000}
          rows={6}
          disabled={loading}
          className={field}
        />
        {me.data && (
          <p className="-mt-1 text-[12px] text-hint">
            {t.meetings.signatureHint} <i>{t.bot.sentBy(displayName(me.data.user))}</i>
          </p>
        )}
        {/* The picture goes with the message (the text under it): none, the poster, or
            the poster moving — previewed live, with its own words on it or none. */}
        {detail.data && (
          <div className="flex flex-col gap-2 rounded-xl bg-hairline/60 p-3">
            <div className="text-[13px] font-semibold">{t.events.pictureTitle}</div>
            <div className="flex flex-wrap gap-1.5">
              {(['none', 'still', 'moving'] as const)
                .filter((k) => (k === 'still' ? !!picture : k === 'moving' ? moves : true))
                .map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      haptic.tap();
                      setPic(k);
                    }}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                      shown === k ? 'bg-[var(--brand)] text-white' : 'bg-hairline'
                    }`}
                  >
                    {t.events.picture[k]}
                  </button>
                ))}
            </div>
            {shown === 'still' && picture && (
              <img src={picture} alt="" className="max-h-56 w-full rounded-lg object-cover" />
            )}
            {shown === 'moving' && (
              <>
                <LivePreview node={movingNode}>
                  <EventMotionPoster e={detail.data} text={words} />
                </LivePreview>
                <PosterTextControls
                  value={words}
                  preset={preset}
                  modes={[...modes]}
                  onChange={(v) => {
                    setStyle(v);
                    if (v.text !== words.text) setOwnWords(v.text);
                  }}
                />
              </>
            )}
            {!moves && (
              <NoMotionPrompt
                onDesign={
                  detail.data.canDesign
                    ? () => {
                        onClose();
                        push({ name: 'eventForm', groupId, eventId });
                      }
                    : undefined
                }
              />
            )}
          </div>
        )}
        {(detail.data?.roles.length ?? 0) > 0 && (
          <div className="overflow-hidden rounded-xl bg-hairline/60">
            <Toggle label={t.events.withRoster} checked={withRoster} onChange={setWithRoster} />
            <p className="-mt-1 px-4 pb-2.5 text-[12px] text-hint">{t.events.withRosterHint}</p>
          </div>
        )}
        <AudienceChoice
          groupId={groupId}
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
        ) : recording !== null ? (
          <div className="flex flex-col gap-1.5 py-1">
            <div className="h-2 overflow-hidden rounded-full bg-hairline">
              <div
                className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-200"
                style={{ width: `${Math.round(recording * 100)}%` }}
              />
            </div>
            <div className="text-center text-[13px] text-hint">
              {t.motionExport.recording(Math.round(recording * 100))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              disabled={loading || test.isPending || !text.trim()}
              onClick={() => void run('test')}
            >
              {t.publish.testSend}
            </Button>
            <Button
              disabled={
                loading ||
                remind.isPending ||
                request.isPending ||
                !text.trim() ||
                audienceEmpty(audience, presets)
              }
              onClick={() => void run(canPublish ? 'send' : 'request')}
            >
              <IconSend size={16} /> {canPublish ? t.events.remindSend : t.publish.request}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
