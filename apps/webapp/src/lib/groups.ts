import type { GroupSummary } from '@church/shared';
import { useNav } from './nav';
import { useGroups, useMe } from './queries';

/** Groups the current user can manage (admins: all; leaders: the ones they lead). */
export function useManagedGroups() {
  const me = useMe();
  const groups = useGroups(true);
  const { activeGroupId } = useNav();
  const isAdmin = me.data?.user.isAdmin === true;
  const managed: GroupSummary[] = (groups.data ?? []).filter(
    (g) => isAdmin || g.myRole === 'leader',
  );
  const active = managed.find((g) => g.id === activeGroupId) ?? managed[0] ?? null;
  return {
    managed,
    active,
    isLoading: groups.isPending,
    isError: groups.isError,
    refetch: groups.refetch,
  };
}
