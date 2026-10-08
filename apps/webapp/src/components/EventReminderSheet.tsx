import { useEffect, useState } from 'react';
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
import { haptic } from '../lib/telegram';
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
  const [withPoster, setWithPoster] = useState(true);
  const picture = detail.data?.botPictureUrl ?? null;

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
    const input = {
      id: eventId,
      text: text.trim() || undefined,
      userIds: audienceIds(audience, presets),
      roster: withRoster,
      poster: withPoster && !!picture,
    };
    try {
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
        {/* The poster goes with the message (as the picture, the text under it). */}
        {detail.data && (
          <div className="overflow-hidden rounded-xl bg-hairline/60">
            {picture ? (
              <>
                <Toggle label={t.events.withPoster} checked={withPoster} onChange={setWithPoster} />
                {withPoster && (
                  <img
                    src={picture}
                    alt=""
                    className="mx-4 mb-3 mt-1 max-h-40 w-[calc(100%-2rem)] rounded-lg object-cover"
                  />
                )}
              </>
            ) : (
              <p className="px-4 py-3 text-[13px] leading-snug text-hint">{t.events.noPoster}</p>
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
