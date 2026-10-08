import { useState } from 'react';
import { displayName, type MeetingPerson } from '@church/shared';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

/** Pick one person from a list (with search); "nobody" clears the choice. */
export function PersonPicker({
  open,
  title,
  people,
  value,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  people: MeetingPerson[] | undefined;
  value: number | null;
  onPick: (id: number | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const needle = q.trim().toLocaleLowerCase();
  const list = (people ?? []).filter(
    (p) => !needle || `${displayName(p)} ${p.username ?? ''}`.toLocaleLowerCase().includes(needle),
  );
  const pick = (id: number | null) => {
    haptic.tap();
    onPick(id);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="px-4 pb-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.meetings.searchPeople}
          className="w-full rounded-xl bg-hairline px-3.5 py-2.5 text-[16px] outline-none placeholder:text-hint"
        />
      </div>
      <button
        type="button"
        onClick={() => pick(null)}
        className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left text-[16px] text-hint active:bg-hairline"
      >
        {t.meetings.nobody}
      </button>
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => pick(p.id)}
          className={`flex min-h-[56px] w-full items-center gap-3 px-5 py-2 text-left active:bg-hairline ${
            value === p.id ? 'bg-brand/10' : ''
          }`}
        >
          <Avatar
            id={p.id}
            firstName={p.firstName}
            lastName={p.lastName}
            size={36}
            photoUrl={p.photoUrl}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-medium">{displayName(p)}</span>
            {p.username && <span className="block text-[13px] text-hint">@{p.username}</span>}
          </span>
          {value === p.id && <span className="text-accent">✓</span>}
        </button>
      ))}
    </Sheet>
  );
}
