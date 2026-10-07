import { useState } from 'react';
import { REPEATS, type RepeatEvery } from '@church/shared';
import { AudiencePicker } from '../components/AudiencePicker';
import { Pill } from '../components/LookControls';
import { MeetingFields, type MeetingFormValue } from '../components/MeetingForm';
import {
  MeetingPosterDesigner,
  initMeetingPoster,
  meetingPosterPayload,
} from '../components/MeetingPosterDesigner';
import { useCoverLook } from '../components/CoverDesigner';
import { useToast } from '../components/Toast';
import { Button, Screen, Section, TextField, Title, Toggle } from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { useCreateMeeting, useGroup } from '../lib/queries';
import { haptic } from '../lib/telegram';

/** How many meetings a repeat starts with. */
const DEFAULT_COUNT: Record<RepeatEvery, number> = { weekly: 12, biweekly: 8, monthly: 6 };

export function NewMeeting({ groupId, date: initialDate }: { groupId: number; date?: string }) {
  const { back, push } = useNav();
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const create = useCreateMeeting(groupId);
  const group = useGroup(groupId);
  const [date, setDate] = useState(() => initialDate ?? f.todayInput());
  const [audience, setAudience] = useState<number[] | null>(null);
  const [form, setForm] = useState<MeetingFormValue>({
    title: t.newMeeting.defaultTitle,
    startTime: '19:00',
    durationMin: 120,
  });
  // A repeating meeting: every date is made at once, so the calendar fills up.
  const [repeats, setRepeats] = useState(false);
  const [every, setEvery] = useState<RepeatEvery>('weekly');
  const [count, setCount] = useState(DEFAULT_COUNT.weekly);
  const [designing, setDesigning] = useState(false);
  const [poster, setPoster] = useState(() => initMeetingPoster());
  const { templateId } = useCoverLook(poster.cover, group.data);
  const countOk = count >= 2 && count <= 52;
  // Only for the poster preview (the server works in the church's time zone).
  const parsed = new Date(`${date}T${form.startTime}`);
  const startsAt = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  async function submit() {
    if (!form.title.trim() || !date || (repeats && !countOk)) return;
    try {
      const meeting = await create.mutateAsync({
        date,
        ...form,
        audience: audience?.length ? audience : undefined,
        ...(designing ? meetingPosterPayload(poster, templateId) : {}),
        repeat: repeats ? { every, count } : null,
      });
      haptic.success();
      toast(repeats ? t.meetings.repeatSummary(count) : t.newMeeting.created);
      back();
      // A meeting that already started can be marked right away.
      if (!repeats && new Date(meeting.startsAt).getTime() <= Date.now() + 3_600_000) {
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
      <Section title={t.meetings.repeatTitle} footer={t.meetings.repeatHint}>
        <Toggle label={t.meetings.repeatTitle} checked={repeats} onChange={setRepeats} />
        {repeats && (
          <div className="flex flex-col gap-3 border-t border-hairline p-4">
            <div className="flex flex-wrap gap-2">
              {REPEATS.map((r) => (
                <Pill
                  key={r}
                  on={every === r}
                  onClick={() => {
                    setEvery(r);
                    setCount(DEFAULT_COUNT[r]);
                  }}
                  label={t.meetings.repeatEvery[r]}
                />
              ))}
            </div>
            <label className="flex items-center justify-between gap-3 text-[15px]">
              <span>{t.meetings.repeatCount}</span>
              <input
                type="number"
                inputMode="numeric"
                min={2}
                max={52}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-20 rounded-xl bg-hairline px-3 py-2 text-center text-[16px] outline-none"
              />
            </label>
            <p className="text-[13px] text-hint">
              {countOk ? t.meetings.repeatSummary(count) : '2–52'}
            </p>
          </div>
        )}
      </Section>
      <Section title={t.meetings.audience}>
        <div className="p-3">
          <AudiencePicker groupId={groupId} value={audience} onChange={setAudience} />
        </div>
      </Section>
      <Section>
        <Toggle label={t.meetings.posterTitle} checked={designing} onChange={setDesigning} />
      </Section>
      {designing && group.data && (
        <MeetingPosterDesigner
          g={group.data}
          groupId={groupId}
          meeting={{
            title: form.title || t.newMeeting.defaultTitle,
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + form.durationMin * 60_000).toISOString(),
            topic: null,
            location: null,
            leader: null,
            kind: null,
          }}
          state={poster}
          onChange={setPoster}
        />
      )}
      <Button
        onClick={() => void submit()}
        disabled={!form.title.trim() || !date || create.isPending || (repeats && !countOk)}
      >
        {t.common.create}
      </Button>
    </Screen>
  );
}
