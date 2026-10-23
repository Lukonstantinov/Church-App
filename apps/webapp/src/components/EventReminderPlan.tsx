import { useRef, useState } from 'react';
import { REMINDER_PLAN_MAX, type EventDetail, type ReminderPlan } from '@church/shared';
import { useT } from '../lib/i18n';
import { useFmt } from '../lib/format';
import { useUpdateEvent } from '../lib/queries';
import { recordPosterVideo } from '../lib/movingPoster';
import { haptic } from '../lib/telegram';
import {
  EventMotionPoster,
  LivePreview,
  eventMoves,
  eventPosterModes,
  useEventPosterText,
} from './MotionExport';
import { posterText } from './PosterText';
import { IconBell } from './icons';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Card } from './ui';

/** Minutes before the start that can be picked. */
const CHOICES = [10080, 2880, 1440, 360, 180, 60, 30];
const DEFAULT_PLAN: ReminderPlan = { minutes: [1440, 60], audience: 'all', picture: 'still' };

const chip = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-[13px] font-semibold ${on ? 'bg-[var(--brand)] text-white' : 'bg-hairline'}`;

/**
 * What the event will send and when: every planned reminder with its date, who gets it and
 * the picture (still or animated poster), and whether it has gone. Managers set it up here;
 * without a plan the ministry's one-number rule applies.
 */
export function EventReminderPlan({ e }: { e: EventDetail }) {
  const t = useT();
  const f = useFmt();
  const [editing, setEditing] = useState(false);
  const plan = e.reminderPlan;
  const who = {
    all: t.events.remindEveryone,
    serving: t.events.remindServing,
    going: t.events.remindGoing,
  };
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[16px] font-semibold">
          <IconBell size={18} /> {t.events.planTitle}
        </span>
        {e.canManage && (
          <Button small variant="glass" onClick={() => setEditing(true)}>
            {t.events.planEdit}
          </Button>
        )}
      </div>
      {!plan ? (
        <p className="text-[13px] leading-snug text-hint">{t.events.planDefault}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-[14px]">
            {e.reminderSlots.map((s) => (
              <li
                key={s.minutes}
                className={`flex justify-between gap-2 ${s.sent ? 'opacity-60' : ''}`}
              >
                <span>
                  {f.weekdayDayMonth(s.at)} · {f.time(s.at)}
                </span>
                <span className="text-hint">
                  {s.sent ? `✓ ${t.events.planSent}` : t.events.planBefore(s.minutes)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-hint">
            {who[plan.audience]} · {t.events.picture[plan.picture]}
          </p>
        </>
      )}
      {editing && <PlanSheet e={e} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function PlanSheet({ e, onClose }: { e: EventDetail; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const update = useUpdateEvent(e.id);
  const [plan, setPlan] = useState<ReminderPlan>(e.reminderPlan ?? DEFAULT_PLAN);
  const [progress, setProgress] = useState<number | null>(null);
  const node = useRef<HTMLDivElement>(null);
  const posterWords = useEventPosterText();
  const moves = eventMoves(e);
  const words = { ...posterText('', eventPosterModes(e)[0]!), text: posterWords(e) };
  const toggle = (m: number) =>
    setPlan((p) => {
      const has = p.minutes.includes(m);
      if (has ? p.minutes.length === 1 : p.minutes.length >= REMINDER_PLAN_MAX) return p;
      return { ...p, minutes: has ? p.minutes.filter((x) => x !== m) : [...p.minutes, m] };
    });

  async function save(next: ReminderPlan | null) {
    try {
      let saved = next;
      if (next?.picture === 'moving') {
        // Recorded now and kept; a phone that can't make videos sends the still poster.
        setProgress(0);
        await new Promise((r) => setTimeout(r, 300));
        const mediaId = node.current
          ? await recordPosterVideo(node.current, e.groupId, setProgress)
          : null;
        if (!mediaId) toast(t.motionExport.noVideo);
        saved = { ...next, picture: mediaId ? 'moving' : 'still', mediaId };
      }
      await update.mutateAsync({ reminderPlan: saved });
      haptic.success();
      onClose();
    } catch {
      haptic.error();
      toast(t.common.actionFailed, 'error');
    } finally {
      setProgress(null);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t.events.planTitle}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="text-[13px] font-semibold">{t.events.planWhen}</div>
        <div className="flex flex-wrap gap-1.5">
          {CHOICES.map((m) => (
            <button
              key={m}
              type="button"
              className={chip(plan.minutes.includes(m))}
              onClick={() => toggle(m)}
            >
              {t.events.planBefore(m)}
            </button>
          ))}
        </div>
        <div className="text-[13px] font-semibold">{t.events.planWho}</div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', t.events.remindEveryone],
              ...(e.roles.length ? [['serving', t.events.remindServing]] : []),
              ...(e.features.rsvp ? [['going', t.events.remindGoing]] : []),
            ] as [ReminderPlan['audience'], string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={chip(plan.audience === k)}
              onClick={() => setPlan({ ...plan, audience: k })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-[13px] font-semibold">{t.events.pictureTitle}</div>
        <div className="flex flex-wrap gap-1.5">
          {(['none', 'still', 'moving'] as const)
            .filter((k) => k !== 'moving' || moves)
            .map((k) => (
              <button
                key={k}
                type="button"
                className={chip(plan.picture === k)}
                onClick={() => setPlan({ ...plan, picture: k })}
              >
                {t.events.picture[k]}
              </button>
            ))}
        </div>
        {plan.picture === 'moving' && (
          <>
            <LivePreview node={node}>
              <EventMotionPoster e={e} text={words} />
            </LivePreview>
            <p className="text-[12px] text-hint">{t.events.planMovingHint}</p>
          </>
        )}
        {progress !== null ? (
          <div className="text-center text-[13px] text-hint">
            {t.motionExport.recording(Math.round(progress * 100))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button disabled={update.isPending} onClick={() => void save(plan)}>
              {t.events.planSave}
            </Button>
            {e.reminderPlan && (
              <Button
                variant="secondary"
                disabled={update.isPending}
                onClick={() => void save(null)}
              >
                {t.events.planUseRule}
              </Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
