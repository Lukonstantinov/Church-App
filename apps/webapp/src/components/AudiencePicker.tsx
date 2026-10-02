import { displayName } from '@church/shared';
import { useT } from '../lib/i18n';
import { useContacts } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { Avatar } from './Avatar';
import { Pill } from './LookControls';
import { Skeleton } from './ui';

/**
 * Who a meeting is for: everyone in the ministry (null) or chosen people. Only the
 * chosen see the meeting and are on its roll call.
 */
export function AudiencePicker({
  groupId,
  value,
  onChange,
  hint,
  bare,
}: {
  groupId: number;
  value: number[] | null;
  onChange: (v: number[] | null) => void;
  /** Replaces the meeting wording under the chips ('' = none). */
  hint?: string;
  /** Only the list of people (the caller has its own choice of audience). */
  bare?: boolean;
}) {
  const t = useT();
  const contacts = useContacts(groupId);
  const chosen = new Set(value ?? []);
  const toggle = (id: number) => {
    haptic.tap();
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className={`flex flex-wrap gap-2 ${bare ? 'hidden' : ''}`}>
        <Pill on={value === null} onClick={() => onChange(null)} label={t.meetings.everyone} />
        <Pill
          on={value !== null}
          onClick={() => onChange(value ?? [])}
          label={value?.length ? t.meetings.chosenCount(value.length) : t.meetings.chosenPeople}
        />
      </div>
      {value !== null && (
        <>
          {(hint ?? t.meetings.audienceHint) && (
            <p className="text-[13px] text-hint">{hint ?? t.meetings.audienceHint}</p>
          )}
          {contacts.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="overflow-hidden rounded-2xl ring-1 ring-hairline">
              {(contacts.data ?? []).map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-[52px] items-center gap-3 border-b border-hairline px-3 py-1.5 last:border-b-0 active:bg-hairline"
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="h-5 w-5 shrink-0 accent-[var(--brand)]"
                  />
                  <Avatar id={c.id} firstName={c.firstName} lastName={c.lastName} size={32} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{displayName(c)}</span>
                  {c.positionName && (
                    <span className="shrink-0 text-[12px] text-hint">{c.positionName}</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
