import { useT } from '../lib/i18n';
import { Pill } from './LookControls';

/**
 * Whether a meeting (or every meeting of a weekly schedule) counts in attendance statistics:
 * by the ministry's rule (its meeting types, set in the ministry's settings), always, or
 * never — e.g. a joint service with another church that shouldn't pull the numbers down.
 */
export function StatChoice({
  value,
  onChange,
  ruleCounts,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  /** What the ministry's rule says for this meeting, when known. */
  ruleCounts?: boolean;
}) {
  const t = useT();
  const ts = t.meetings.stats;
  return (
    <div>
      <div className="mb-2 text-[13px] text-hint">📊 {ts.title}</div>
      <div className="flex flex-wrap gap-2">
        <Pill
          on={value === null}
          onClick={() => onChange(null)}
          label={ruleCounts === undefined ? ts.rule : `${ts.rule} (${ruleCounts ? ts.yes : ts.no})`}
        />
        <Pill on={value === true} onClick={() => onChange(true)} label={ts.count} />
        <Pill on={value === false} onClick={() => onChange(false)} label={ts.skip} />
      </div>
    </div>
  );
}
