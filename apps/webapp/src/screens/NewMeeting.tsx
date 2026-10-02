import { useState } from 'react';
import { AudiencePicker } from '../components/AudiencePicker';
import { MeetingFields, type MeetingFormValue } from '../components/MeetingForm';
import { useToast } from '../components/Toast';
import { Button, Screen, Section, Switch, TextField, Title } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useCreateMeeting, useMembers } from '../lib/queries';
import { haptic } from '../lib/telegram';

export function NewMeeting({ groupId, date: initialDate }: { groupId: number; date?: string }) {
  const { back, push } = useNav();
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const create = useCreateMeeting(groupId);
  const [date, setDate] = useState(() => initialDate ?? f.todayInput());
  const [audience, setAudience] = useState<number[] | null>(null);
  // A leaders' meeting: only chosen people (the leaders to start with), its own poster.
  const [leaders, setLeaders] = useState(false);
  const members = useMembers(groupId);
  const [form, setForm] = useState<MeetingFormValue>({
    title: t.newMeeting.defaultTitle,
    startTime: '19:00',
    durationMin: 120,
  });

  async function submit() {
    if (!form.title.trim() || !date) return;
    try {
      const meeting = await create.mutateAsync({
        date,
        ...form,
        audience: audience?.length ? audience : undefined,
        kind: leaders ? 'leaders' : undefined,
      });
      haptic.success();
      toast(t.newMeeting.created);
      back();
      // A meeting that already started can be marked right away.
      if (new Date(meeting.startsAt).getTime() <= Date.now() + 3_600_000) {
        push({ name: 'roll', meetingId: meeting.id });
      }
    } catch {
      toast(t.newMeeting.failed, 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle={t.newMeeting.subtitle}>{t.newMeeting.title}</Title>
      <button
        type="button"
        role="switch"
        aria-checked={leaders}
        onClick={() => {
          const on = !leaders;
          setLeaders(on);
          if (on) {
            if (form.title === t.newMeeting.defaultTitle)
              setForm({ ...form, title: t.meetings.leadersMeeting });
            if (!audience?.length)
              setAudience(
                (members.data ?? [])
                  .filter((m) => m.status === 'active' && m.role === 'leader')
                  .map((m) => m.userId),
              );
          } else if (form.title === t.meetings.leadersMeeting) {
            setForm({ ...form, title: t.newMeeting.defaultTitle });
          }
        }}
        className={`flex items-center gap-3 rounded-[var(--radius-card)] p-4 text-left shadow-card ${
          leaders ? 'text-white' : 'glass'
        }`}
        style={
          leaders
            ? { background: 'linear-gradient(135deg, #0b1220, #1e293b 60%, #3b2f12)' }
            : undefined
        }
      >
        <span className="text-[26px]">👑</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">{t.meetings.leadersMeeting}</span>
          <span className={`block text-[12px] ${leaders ? 'text-white/75' : 'text-hint'}`}>
            {t.meetings.leadersMeetingHint}
          </span>
        </span>
        <Switch on={leaders} />
      </button>
      <Section>
        <TextField label={t.meetingForm.date} type="date" value={date} onChange={setDate} />
      </Section>
      <MeetingFields value={form} onChange={(patch) => setForm({ ...form, ...patch })} />
      <Section title={t.meetings.audience}>
        <div className="p-3">
          <AudiencePicker groupId={groupId} value={audience} onChange={setAudience} />
        </div>
      </Section>
      <Button
        onClick={() => void submit()}
        disabled={!form.title.trim() || !date || create.isPending || (leaders && !audience?.length)}
      >
        {t.common.create}
      </Button>
    </Screen>
  );
}
