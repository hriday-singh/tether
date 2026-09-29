/** Minimal external store for useSyncExternalStore. Snapshots are immutable and only replaced on change. */
export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface WritableStore<T> extends ReadableStore<T> {
  set(next: T): void;
  update(fn: (prev: T) => T): void;
}

export function createStore<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): WritableStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    if (equals(value, next)) return;
    value = next;
    listeners.forEach((l) => l());
  };
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    update: (fn) => set(fn(value)),
  };
}

/** Shallow equality for flat objects: keeps React from re-rendering on identical snapshots. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof T)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}
