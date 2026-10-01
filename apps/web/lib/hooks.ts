'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReadableStore } from './store';

export function useStore<T, S = T>(
  store: ReadableStore<T>,
  selector?: (state: T) => S,
  equals: (a: S, b: S) => boolean = Object.is,
): S {
  const cacheRef = useRef<{ raw: T; slice: S; selector: ((state: T) => S) | undefined } | null>(null);

  const getSnapshot = useCallback(() => {
    const raw = store.get();
    if (!selector) {
      return raw as unknown as S;
    }
    const cache = cacheRef.current;
    if (cache && cache.selector === selector && Object.is(cache.raw, raw)) {
      return cache.slice;
    }
    const nextSlice = selector(raw);
    if (cache && equals(cache.slice, nextSlice)) {
      cache.raw = raw;
      cache.selector = selector;
      return cache.slice;
    }
    cacheRef.current = { raw, slice: nextSlice, selector };
    return nextSlice;
  }, [store, selector, equals]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

const subscribeNoop = () => () => {};

/** False during SSR and hydration, true after mount. Avoids hydration mismatches for client-only UI. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/**
 * Workspace viewport gate (docs/ui-ux/03 §3): live `matchMedia` listener, so widening the window unblocks
 * without a reload. Returns null before mount so neither the gate nor the workspace flashes.
 */
export function useViewportGate({ minWidth }: { minWidth: number }): boolean | null {
  const query = `(min-width: ${minWidth}px)`;
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => null,
  );
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Re-renders every `ms`. Use for relative times ("Verified 3s ago"). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** true for `ms` after `trigger()` is called. Drives copy -> check morphs. */
export function useFlag(ms = 2000): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const trigger = useCallback(() => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, trigger];
}
