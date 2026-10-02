import { useState } from 'react';
import type { EventSummary } from '@church/shared';
import { EventReminderSheet } from '../components/EventReminderSheet';
import { useEventWhen } from '../components/EventCard';
import { IconBell } from '../components/icons';
import { Card, EmptyState, Loading, Row, Screen, Section, Title } from '../components/ui';
import { useT } from '../lib/i18n';
import { useEvents, useGroup } from '../lib/queries';

/**
 * Event reminders for leaders: pick a coming event, read and change the text, and send
 * it to everyone in the ministry or only chosen people. The recipients see who sent it.
 */
export function Reminders({ groupId }: { groupId: number }) {
  const t = useT();
  const when = useEventWhen();
  const group = useGroup(groupId);
  const events = useEvents(groupId, 'upcoming');
  const [picked, setPicked] = useState<EventSummary | null>(null);
  if (events.isPending) return <Loading />;
  const list = (events.data ?? []).filter((e) => e.status !== 'cancelled');
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
        <Section title={t.events.remindPick}>
          {list.map((e) => (
            <Row
              key={e.id}
              before={
                <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
                  <IconBell size={18} />
                </span>
              }
              title={e.title}
              subtitle={when(e)}
              onClick={() => setPicked(e)}
            />
          ))}
        </Section>
      )}
      {picked && (
        <EventReminderSheet
          eventId={picked.id}
          groupId={picked.groupId}
          title={picked.title}
          onClose={() => setPicked(null)}
        />
      )}
    </Screen>
  );
}
