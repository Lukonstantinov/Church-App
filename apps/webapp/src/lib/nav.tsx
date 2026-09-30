import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { webApp } from './telegram';

export type Route =
  | { name: 'home' }
  | { name: 'group'; groupId: number }
  | { name: 'member'; userId: number; groupId?: number }
  | { name: 'createGroup' }
  | { name: 'addOffline'; groupId: number };

interface Nav {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
}

const NavContext = createContext<Nav | null>(null);

/**
 * Minimal stack navigation. Telegram's native Back button is shown whenever
 * there is somewhere to go back to.
 */
export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const push = useCallback((r: Route) => {
    setStack((s) => [...s, r]);
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

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

  const value = useMemo(
    () => ({ route: stack[stack.length - 1]!, push, back }),
    [stack, push, back],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}
