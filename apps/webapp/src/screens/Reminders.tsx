import { useState } from 'react';
import type { EventSummary } from '@church/shared';
import { EventReminderSheet } from '../components/EventReminderSheet';
import { PlanSheet } from '../components/EventReminderPlan';
import { useEventWhen } from '../components/EventCard';
import { IconBell, IconRepeat } from '../components/icons';
import { Button, Card, EmptyState, Loading, Row, Screen, Section, Title } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useEvent, useEvents, useGroup, useSchedules } from '../lib/queries';

/**
 * Reminders for leaders. Every coming event is listed with what it will send and when;
 * tap «Reminders» to change that event's plan (times, who, words, picture — still or
 * moving) or send one now. Regular meetings are listed under it, to change how often they
 * meet and the rest.
 */
export function Reminders({ groupId }: { groupId: number }) {
  const t = useT();
  const { push } = useNav();
  const f = useFmt();
  const group = useGroup(groupId);
  const events = useEvents(groupId, 'upcoming');
  const schedules = useSchedules(groupId);
  const [sending, setSending] = useState<EventSummary | null>(null);
  const [planning, setPlanning] = useState<number | null>(null);
  if (events.isPending) return <Loading />;
  const list = (events.data ?? []).filter((e) => e.status !== 'cancelled');
  const regular = schedules.data ?? [];
  return (
    <Screen>
      <Title subtitle={group.data?.name}>{t.events.remindTitle}</Title>
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<IconBell size={26} />} title={t.events.remindNone}>
            {t.events.remindEntry}
          </EmptyState>
        </Card>
      ) : (
        <Section title={t.events.remindAllTitle}>
          {list.map((e) => (
            <EventLine
              key={e.id}
              e={e}
              onSend={() => setSending(e)}
              onPlan={() => setPlanning(e.id)}
            />
          ))}
        </Section>
      )}
      {regular.length > 0 && (
        <Section title={t.events.remindRegularTitle} footer={t.events.remindRegularHint}>
          {regular.map((s) => (
            <Row
              key={s.id}
              before={
                <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
                  <IconRepeat size={18} />
                </span>
              }
              title={s.title}
              subtitle={`${s.everyWeeks > 1 ? t.schedule.repeatEvery(s.everyWeeks) : f.every(s.weekday)} · ${s.startTime}${s.active ? '' : ' · ⏸'}`}
              onClick={() => push({ name: 'schedule', groupId })}
            />
          ))}
        </Section>
      )}
      {sending && (
        <EventReminderSheet
          eventId={sending.id}
          groupId={sending.groupId}
          title={sending.title}
          onClose={() => setSending(null)}
        />
      )}
      {planning !== null && <PlanFor id={planning} onClose={() => setPlanning(null)} />}
    </Screen>
  );
}

/** One event: when it is, what its reminders are, and the two ways to change them. */
function EventLine({
  e,
  onSend,
  onPlan,
}: {
  e: EventSummary;
  onSend: () => void;
  onPlan: () => void;
}) {
  const t = useT();
  const when = useEventWhen();
  const detail = useEvent(e.id);
  const plan = detail.data?.reminderPlan;
  return (
    <div className="flex flex-col gap-2 border-b border-hairline px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-[16px] font-semibold">{e.title}</div>
        <div className="text-[13px] text-hint">{when(e)}</div>
        <div className="text-[13px] text-hint">
          🔔{' '}
          {plan
            ? plan.minutes
                .slice()
                .sort((a, b) => b - a)
                .map((m) => t.events.planBefore(m))
                .join(' · ')
            : t.events.remindNoPlan}
          {plan?.picture === 'moving' ? ' · 🎬' : ''}
        </div>
      </div>
      <div className="flex gap-2">
        <Button small variant="glass" onClick={onPlan}>
          {t.events.planOpen}
        </Button>
        <Button small variant="glass" onClick={onSend}>
          {t.events.remindTitle}
        </Button>
      </div>
    </div>
  );
}

/** The plan sheet of an event, once its details have arrived. */
function PlanFor({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useEvent(id);
  if (!detail.data) return null;
  return <PlanSheet e={detail.data} onClose={onClose} />;
}
