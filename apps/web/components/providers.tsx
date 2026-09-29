'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/controls';
import { Toaster } from '@/components/ui/toaster';
import {
  applyDocumentPrefs,
  DEFAULT_PREFERENCES,
  loadPreferences,
  PREFS_KEY,
  savePreferences,
  type UserPreferences,
} from '@/lib/prefs';

interface PrefsContextValue {
  prefs: UserPreferences;
  setPrefs: (patch: Partial<UserPreferences>) => void;
}

const PrefsContext = createContext<PrefsContextValue>({ prefs: DEFAULT_PREFERENCES, setPrefs: () => {} });

export function usePrefs(): PrefsContextValue {
  return useContext(PrefsContext);
}

function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<UserPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    // Hydrate from storage after mount; the <head> boot script already painted the right theme.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
    setState(loadPreferences());
    const onStorage = (e: StorageEvent) => e.key === PREFS_KEY && setState(loadPreferences());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPrefs = useCallback((patch: Partial<UserPreferences>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      savePreferences(next);
      applyDocumentPrefs(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <TooltipProvider delayDuration={400} skipDelayDuration={200}>
          {children}
          <Toaster />
        </TooltipProvider>
      </PrefsProvider>
    </QueryClientProvider>
  );
}
