import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { GroupSummary, MeResponse, Permission } from '@church/shared';

/**
 * The environment (ministry) the user is inside, with their rights there. Screens use
 * `can()` to show only the actions the person's position allows; the server checks
 * every right again.
 */
export interface EnvCtx {
  env: GroupSummary | null;
  can: (p: Permission) => boolean;
  /** Any management right at all. */
  manages: boolean;
}

const EnvContext = createContext<EnvCtx>({ env: null, can: () => false, manages: false });

export function EnvProvider({ env, children }: { env: GroupSummary | null; children: ReactNode }) {
  const value = useMemo<EnvCtx>(() => {
    const perms = new Set(env?.myPermissions ?? []);
    return { env, can: (p) => perms.has(p), manages: perms.size > 0 };
  }, [env]);
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

export const useEnv = () => useContext(EnvContext);

/** A person with exactly one environment (and not a church admin) skips the hub. */
export function soloEnvironment(me: MeResponse): number | null {
  if (me.user.isAdmin) return null;
  const active = me.memberships.filter((m) => m.status === 'active');
  return active.length === 1 ? active[0]!.groupId : null;
}
