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

export type Tab = 'overview' | 'meetings' | 'people' | 'more';

export type Route =
  | { name: 'root' }
  | { name: 'roll'; meetingId: number }
  | { name: 'schedule'; groupId: number }
  | { name: 'newMeeting'; groupId: number }
  | { name: 'member'; userId: number }
  | { name: 'createGroup' }
  | { name: 'addOffline'; groupId: number };

/** Return false to cancel the navigation (e.g. the user chose to keep editing). */
type BackGuard = () => boolean | Promise<boolean>;

interface Nav {
  route: Route;
  push: (r: Route) => void;
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

  const value = useMemo<Nav>(
    () => ({
      route: stack[stack.length - 1]!,
      push,
      back,
      tab,
      setTab,
      activeGroupId,
      setActiveGroupId,
      setBackGuard,
    }),
    [stack, push, back, tab, activeGroupId, setActiveGroupId, setBackGuard],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}
