import { useState } from 'react';
import { MeetingFields, type MeetingFormValue } from '../components/MeetingForm';
import { useToast } from '../components/Toast';
import { Button, Screen, Section, TextField, Title } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useCreateMeeting } from '../lib/queries';
import { haptic } from '../lib/telegram';

export function NewMeeting({ groupId }: { groupId: number }) {
  const { back, push } = useNav();
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const create = useCreateMeeting(groupId);
  const [date, setDate] = useState(() => f.todayInput());
  const [form, setForm] = useState<MeetingFormValue>({
    title: t.newMeeting.defaultTitle,
    startTime: '19:00',
    durationMin: 120,
  });

  async function submit() {
    if (!form.title.trim() || !date) return;
    try {
      const meeting = await create.mutateAsync({ date, ...form });
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
      <Section>
        <TextField label={t.meetingForm.date} type="date" value={date} onChange={setDate} />
      </Section>
      <MeetingFields value={form} onChange={(patch) => setForm({ ...form, ...patch })} />
      <Button
        onClick={() => void submit()}
        disabled={!form.title.trim() || !date || create.isPending}
      >
        {t.common.create}
      </Button>
    </Screen>
  );
}
