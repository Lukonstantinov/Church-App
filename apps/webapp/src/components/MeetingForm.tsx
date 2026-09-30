import { WEEKDAYS_SHORT, durationLabel } from '../lib/format';
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
  return (
    <>
      <div className="overflow-hidden rounded-xl bg-section shadow-card">
        <TextField label="Название" value={value.title} onChange={(title) => onChange({ title })} />
        <TimeField
          label="Начало"
          value={value.startTime}
          onChange={(startTime) => onChange({ startTime })}
        />
      </div>
      <div>
        <div className="mb-1.5 px-2 text-[13px] text-hint">Длительность</div>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <Pill
              key={d}
              selected={value.durationMin === d}
              onClick={() => onChange({ durationMin: d })}
            >
              {durationLabel(d)}
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
  return (
    <div>
      <div className="mb-1.5 px-2 text-[13px] text-hint">День недели</div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS_SHORT.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={value === i}
            onClick={() => onChange(i)}
            className={`min-h-[44px] rounded-xl text-[15px] font-medium active:opacity-80 ${
              value === i ? 'bg-button text-button-text' : 'bg-hairline'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
