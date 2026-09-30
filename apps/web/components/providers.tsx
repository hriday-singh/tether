'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const prefsRef = useRef(prefs);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    // Hydrate from storage after mount; the <head> boot script already painted the right theme.
    const initial = loadPreferences();
    prefsRef.current = initial;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
    setState(initial);
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) {
        const loaded = loadPreferences();
        prefsRef.current = loaded;
        setState(loaded);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPrefs = useCallback((patch: Partial<UserPreferences>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setState(next);
    savePreferences(next);
    applyDocumentPrefs(next);
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
