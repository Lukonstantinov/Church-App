import { useEffect, useState } from 'react';
import { displayName, type EventSummary } from '@church/shared';
import { AudiencePicker } from '../components/AudiencePicker';
import { useEventWhen } from '../components/EventCard';
import { IconBell, IconCheck, IconSend } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, Loading, Row, Screen, Section, Title } from '../components/ui';
import { useT } from '../lib/i18n';
import { fetchReminderText, useEvents, useGroup, useMe, useRemindEvent } from '../lib/queries';
import { haptic } from '../lib/telegram';

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
      {picked && <ReminderSheet e={picked} onClose={() => setPicked(null)} />}
    </Screen>
  );
}

function ReminderSheet({ e, onClose }: { e: EventSummary; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const remind = useRemindEvent();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState<number[] | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchReminderText(e.id)
      .then((r) => setText(r.text))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let alive = true;
    fetchReminderText(e.id)
      .then((r) => alive && setText(r.text))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [e.id]);

  async function send() {
    try {
      const res = await remind.mutateAsync({
        id: e.id,
        text: text.trim() || undefined,
        userIds: audience,
      });
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
    <Sheet open onClose={onClose} title={e.title}>
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
        <AudiencePicker groupId={e.groupId} value={audience} onChange={setAudience} hint="" />
        {done !== null ? (
          <div className="flex items-center justify-center gap-1.5 py-2 text-[15px] font-semibold text-present">
            <IconCheck size={18} /> {t.events.remindSent(done)}
          </div>
        ) : (
          <Button
            disabled={loading || remind.isPending || !text.trim() || audience?.length === 0}
            onClick={() => void send()}
          >
            <IconSend size={16} /> {t.events.remindSend}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
