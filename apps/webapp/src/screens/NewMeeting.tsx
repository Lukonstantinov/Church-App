import { useState } from 'react';
import { MeetingFields, type MeetingFormValue } from '../components/MeetingForm';
import { useToast } from '../components/Toast';
import { Button, Screen, Section, TextField, Title } from '../components/ui';
import { todayInput } from '../lib/format';
import { useNav } from '../lib/nav';
import { useCreateMeeting, useMe } from '../lib/queries';
import { haptic } from '../lib/telegram';

export function NewMeeting({ groupId }: { groupId: number }) {
  const { back, push } = useNav();
  const me = useMe();
  const toast = useToast();
  const create = useCreateMeeting(groupId);
  const tz = me.data?.church.timezone ?? 'Europe/Riga';
  const [date, setDate] = useState(() => todayInput(tz));
  const [form, setForm] = useState<MeetingFormValue>({
    title: 'Встреча',
    startTime: '19:00',
    durationMin: 120,
  });

  async function submit() {
    if (!form.title.trim() || !date) return;
    try {
      const meeting = await create.mutateAsync({ date, ...form });
      haptic.success();
      toast('Встреча создана');
      back();
      // A meeting that already started can be marked right away.
      if (new Date(meeting.startsAt).getTime() <= Date.now() + 3_600_000) {
        push({ name: 'roll', meetingId: meeting.id });
      }
    } catch {
      toast('Не удалось создать встречу', 'error');
    }
  }

  return (
    <Screen>
      <Title subtitle="Разовое событие или встреча, которую нужно внести задним числом">
        Новая встреча
      </Title>
      <Section>
        <TextField label="Дата" type="date" value={date} onChange={setDate} />
      </Section>
      <MeetingFields value={form} onChange={(patch) => setForm({ ...form, ...patch })} />
      <Button
        onClick={() => void submit()}
        disabled={!form.title.trim() || !date || create.isPending}
      >
        Создать
      </Button>
    </Screen>
  );
}
