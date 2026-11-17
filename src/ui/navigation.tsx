import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';

/**
 * Minimal stack + tabs router. The app has a handful of screens, so a dependency-free
 * router keeps the build small and removes a whole class of native-module version issues.
 */

export type Tab = 'watch' | 'history' | 'settings';

export type PermissionKind = 'capture_denied' | 'overlay_needed' | 'unsupported' | 'capture_error';

export type Route =
  | { name: 'tabs' }
  | { name: 'offer'; id: number }
  | { name: 'zones' }
  | { name: 'grader' }
  | { name: 'permission'; kind: PermissionKind; reason?: string };

interface Nav {
  stack: Route[];
  tab: Tab;
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  pop: () => void;
  reset: () => void;
}

const NavContext = createContext<Nav | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'tabs' }]);
  const [tab, setTab] = useState<Tab>('watch');

  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback(() => setStack([{ name: 'tabs' }]), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      if (tab !== 'watch') {
        setTab('watch');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, pop]);

  const value = useMemo(() => ({ stack, tab, setTab, push, pop, reset }), [stack, tab, push, pop, reset]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside NavigationProvider');
  return n;
}
