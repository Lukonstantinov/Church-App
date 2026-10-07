import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { storage } from './storage';
import { webApp } from './telegram';

export type Tab = 'overview' | 'meetings' | 'treasury' | 'people' | 'more';

export type Route =
  | { name: 'root' }
  /** Inside one environment (its tabs, theme and data). */
  | { name: 'env'; groupId: number }
  | { name: 'roll'; meetingId: number }
  | { name: 'schedule'; groupId: number }
  | { name: 'newMeeting'; groupId: number; date?: string }
  | { name: 'member'; userId: number }
  | { name: 'createGroup' }
  | { name: 'settings' }
  | { name: 'announcements'; groupId: number }
  | { name: 'post'; groupId: number; postId: number }
  | { name: 'newPost'; groupId: number }
  | { name: 'editPost'; groupId: number; postId: number }
  | { name: 'telemetry' }
  | { name: 'guide' }
  | {
      name: 'newTransaction';
      groupId: number;
      kind: 'income' | 'expense' | 'donation';
      meetingId?: number;
    }
  | { name: 'meeting'; meetingId: number }
  /** The person's own job on a meeting (leader / snack), not the manager view. */
  | { name: 'task'; meetingId: number }
  | { name: 'contacts'; groupId: number }
  | { name: 'event'; eventId: number }
  | { name: 'reminders'; groupId: number }
  | { name: 'labels'; groupId: number }
  | { name: 'notifications' }
  | { name: 'eventForm'; groupId: number; eventId?: number; date?: string }
  | { name: 'groupSettings'; groupId: number }
  | { name: 'reports'; groupId: number }
  | { name: 'stats'; groupId: number }
  | { name: 'positions'; groupId: number }
  | { name: 'position'; groupId: number; positionId?: number }
  | { name: 'addPerson'; groupId: number }
  | { name: 'addOffline'; groupId: number };

/** Return false to cancel the navigation (e.g. the user chose to keep editing). */
type BackGuard = () => boolean | Promise<boolean>;

interface Nav {
  route: Route;
  /** The environment currently open (nearest 'env' screen below the top), if any. */
  envId: number | null;
  push: (r: Route) => void;
  /** Swap the current screen for another (e.g. form → the thing it created). */
  replace: (r: Route) => void;
  back: () => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  activeGroupId: number | null;
  setActiveGroupId: (id: number) => void;
  /** Register a check that runs before leaving the current screen; returns an unregister fn. */
  setBackGuard: (g: BackGuard | null) => void;
}

const NavContext = createContext<Nav | null>(null);
const GROUP_KEY = 'church.activeGroup';

/**
 * Minimal navigation: bottom tabs on the root screen, a stack of detail screens above
 * it. Telegram's native Back button is shown whenever there is somewhere to go back to.
 */
export function NavProvider({ children, initial }: { children: ReactNode; initial?: Route }) {
  const [stack, setStack] = useState<Route[]>(
    initial ? [{ name: 'root' }, initial] : [{ name: 'root' }],
  );
  const [tab, setTab] = useState<Tab>('overview');
  const [activeGroupId, setActive] = useState<number | null>(() => {
    const raw = storage.get(GROUP_KEY);
    return raw ? Number(raw) || null : null;
  });
  const guard = useRef<BackGuard | null>(null);

  const push = useCallback((r: Route) => {
    setStack((s) => [...s, r]);
    if (r.name === 'env') {
      // Entering an environment starts on its overview and makes it the active group.
      setTab('overview');
      setActive(r.groupId);
      storage.set(GROUP_KEY, String(r.groupId));
    }
    window.scrollTo(0, 0);
  }, []);

  const replace = useCallback((r: Route) => {
    guard.current = null;
    setStack((s) => [...s.slice(0, -1), r]);
    if (r.name === 'env') {
      setTab('overview');
      setActive(r.groupId);
      storage.set(GROUP_KEY, String(r.groupId));
    }
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => {
    void (async () => {
      if (guard.current && !(await guard.current())) return;
      guard.current = null;
      setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    })();
  }, []);

  const setActiveGroupId = useCallback((id: number) => {
    setActive(id);
    storage.set(GROUP_KEY, String(id));
  }, []);

  const setBackGuard = useCallback((g: BackGuard | null) => {
    guard.current = g;
  }, []);

  useEffect(() => {
    const button = webApp()?.BackButton;
    if (!button) return;
    if (stack.length > 1) button.show();
    else button.hide();
    button.onClick(back);
    return () => {
      button.offClick(back);
    };
  }, [stack.length, back]);

  const envId = useMemo(() => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const r = stack[i]!;
      if (r.name === 'env') return r.groupId;
    }
    return null;
  }, [stack]);

  const value = useMemo<Nav>(
    () => ({
      route: stack[stack.length - 1]!,
      envId,
      push,
      replace,
      back,
      tab,
      setTab,
      activeGroupId,
      setActiveGroupId,
      setBackGuard,
    }),
    [stack, envId, push, replace, back, tab, activeGroupId, setActiveGroupId, setBackGuard],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}
