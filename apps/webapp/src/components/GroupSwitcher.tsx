import { useState } from 'react';
import { plural, type GroupSummary } from '@church/shared';
import { IconChevronDown, IconCheck } from './icons';
import { Sheet, SheetOption } from './Sheet';
import { useNav } from '../lib/nav';

/** Screen title that doubles as the group picker when there is more than one group. */
export function GroupSwitcher({
  groups,
  active,
  subtitle,
}: {
  groups: GroupSummary[];
  active: GroupSummary;
  subtitle?: string;
}) {
  const { setActiveGroupId } = useNav();
  const [open, setOpen] = useState(false);
  const multiple = groups.length > 1;

  return (
    <header className="px-1 pt-1">
      {multiple ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-ml-1 flex min-h-[44px] max-w-full items-center gap-1 rounded-xl px-1 text-left active:opacity-70"
          aria-haspopup="dialog"
        >
          <h1 className="truncate text-[26px] font-bold leading-tight">{active.name}</h1>
          <IconChevronDown className="mt-1 shrink-0 text-hint" />
        </button>
      ) : (
        <h1 className="text-[26px] font-bold leading-tight">{active.name}</h1>
      )}
      {subtitle && <div className="text-[15px] text-hint">{subtitle}</div>}
      <Sheet open={open} onClose={() => setOpen(false)} title="Группа">
        {groups.map((g) => (
          <SheetOption
            key={g.id}
            label={g.name}
            hint={`${g.activeCount} ${plural(g.activeCount, ['участник', 'участника', 'участников'])}`}
            selected={g.id === active.id}
            icon={g.id === active.id ? <IconCheck size={18} /> : undefined}
            onClick={() => {
              setActiveGroupId(g.id);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </header>
  );
}
