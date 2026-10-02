import { AudiencePicker } from './AudiencePicker';
import { Pill } from './LookControls';
import { useT } from '../lib/i18n';

/** Who a notification goes to: a preset group of people, or chosen ones one by one. */
export type Audience = { kind: string; chosen: number[] };

export interface AudiencePreset {
  key: string;
  label: string;
  /** null = everyone in the ministry. */
  ids: number[] | null;
}

/** The people (user ids) to send to, or null for everyone. */
export function audienceIds(a: Audience, presets: AudiencePreset[]): number[] | null {
  if (a.kind === 'chosen') return a.chosen;
  return presets.find((p) => p.key === a.kind)?.ids ?? null;
}

/** True when the choice leaves nobody to send to. */
export const audienceEmpty = (a: Audience, presets: AudiencePreset[]) => {
  const ids = audienceIds(a, presets);
  return ids !== null && ids.length === 0;
};

/**
 * Chips for the usual audiences (everyone, those who serve, …) plus "chosen people",
 * which opens the list of the ministry's people to tick.
 */
export function AudienceChoice({
  groupId,
  presets,
  value,
  onChange,
}: {
  groupId: number;
  presets: AudiencePreset[];
  value: Audience;
  onChange: (a: Audience) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Pill
            key={p.key}
            on={value.kind === p.key}
            onClick={() => onChange({ ...value, kind: p.key })}
            label={p.ids ? `${p.label} · ${p.ids.length}` : p.label}
          />
        ))}
        <Pill
          on={value.kind === 'chosen'}
          onClick={() => onChange({ ...value, kind: 'chosen' })}
          label={
            value.chosen.length > 0
              ? t.meetings.chosenCount(value.chosen.length)
              : t.meetings.chosenPeople
          }
        />
      </div>
      {value.kind === 'chosen' && (
        <AudiencePicker
          groupId={groupId}
          value={value.chosen}
          onChange={(ids) => onChange({ ...value, chosen: ids ?? [] })}
          hint=""
          bare
        />
      )}
    </div>
  );
}
