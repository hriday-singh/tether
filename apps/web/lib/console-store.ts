import type { ConsoleLevel } from './preview';
import { createStore } from './store';

export interface ConsoleEntry {
  id: number;
  level: ConsoleLevel | 'result' | 'input';
  text: string;
  at: number;
  source: 'preview' | 'runner' | 'system';
}

const CAP = 500;

/** DevTools console buffer (docs/ui-ux/05 §4). Capped so a chatty loop cannot grow memory without bound. */
export function createConsoleStore() {
  const store = createStore<readonly ConsoleEntry[]>([]);
  let next = 1;
  return {
    ...store,
    push(level: ConsoleEntry['level'], text: string, source: ConsoleEntry['source']) {
      store.update((prev) => {
        const entry: ConsoleEntry = { id: next++, level, text, at: Date.now(), source };
        return prev.length >= CAP ? [...prev.slice(prev.length - CAP + 1), entry] : [...prev, entry];
      });
    },
    clear() {
      store.set([]);
    },
  };
}
export type ConsoleStore = ReturnType<typeof createConsoleStore>;
