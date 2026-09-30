import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { Pill, TextField, TimeField } from './ui';

export const DURATIONS = [60, 90, 120, 180];

export interface MeetingFormValue {
  title: string;
  startTime: string;
  durationMin: number;
}

/** Fields shared by the schedule editor and the one-off meeting form. */
export function MeetingFields({
  value,
  onChange,
}: {
  value: MeetingFormValue;
  onChange: (patch: Partial<MeetingFormValue>) => void;
}) {
  const t = useT();
  const f = useFmt();
  return (
    <>
      <div className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
        <TextField
          label={t.meetingForm.title}
          value={value.title}
          onChange={(title) => onChange({ title })}
        />
        <TimeField
          label={t.meetingForm.start}
          value={value.startTime}
          onChange={(startTime) => onChange({ startTime })}
        />
      </div>
      <div>
        <div className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
          {t.meetingForm.duration}
        </div>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <Pill
              key={d}
              selected={value.durationMin === d}
              onClick={() => onChange({ durationMin: d })}
            >
              {f.duration(d)}
            </Pill>
          ))}
        </div>
      </div>
    </>
  );
}

export function WeekdayPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (d: number) => void;
}) {
  const t = useT();
  const f = useFmt();
  return (
    <div>
      <div className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-section-header">
        {t.meetingForm.weekday}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {f.weekdaysShort.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={value === i}
            aria-label={f.weekdaysLong[i]}
            onClick={() => onChange(i)}
            className={`min-h-[46px] rounded-2xl text-[14px] font-semibold transition active:scale-95 ${
              value === i ? 'brand-gradient text-white shadow-cta' : 'glass'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
