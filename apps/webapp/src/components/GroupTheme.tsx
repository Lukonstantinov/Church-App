import { useEffect, type ReactNode } from 'react';
import { EnvProvider, useEnv } from '../lib/env';
import { useGroups, useMe } from '../lib/queries';
import { applyBrand } from '../lib/theme';

/**
 * Wraps a screen opened without going through its ministry (a bot link, the calendar) so
 * it still wears that ministry's colour, pattern and photo, and its rights apply.
 */
export function GroupTheme({ groupId, children }: { groupId: number; children: ReactNode }) {
  const groups = useGroups();
  const outer = useEnv();
  const me = useMe();
  const g = groups.data?.find((x) => x.id === groupId) ?? null;
  const church = me.data?.church.brandColor;
  const target = g?.brandColor ?? church;
  const restore = outer.env?.brandColor ?? church;
  useEffect(() => {
    if (!g) return;
    applyBrand(target);
    return () => applyBrand(restore);
  }, [g, target, restore]);
  return <EnvProvider env={g ?? outer.env}>{children}</EnvProvider>;
}
