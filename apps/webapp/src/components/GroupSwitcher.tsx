import { useState } from 'react';
import { groupColor, type GroupSummary } from '@church/shared';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';
import { BrandHeader } from './BrandHeader';
import { Sheet, SheetOption } from './Sheet';

export function GroupDot({
  id,
  size = 10,
  theme,
}: {
  id: number;
  size?: number;
  theme?: string | null;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: groupColor(id, theme) }}
    />
  );
}

/** Root-screen header whose title is the active group; tap it to switch groups. */
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const multiple = groups.length > 1;

  return (
    <>
      <BrandHeader
        title={active.name}
        subtitle={subtitle}
        onTitleClick={multiple ? () => setOpen(true) : undefined}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={t.nav.group}>
        {groups.map((g) => (
          <SheetOption
            key={g.id}
            icon={<GroupDot id={g.id} size={12} />}
            label={g.name}
            hint={t.common.members(g.activeCount)}
            selected={g.id === active.id}
            onClick={() => {
              setActiveGroupId(g.id);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
