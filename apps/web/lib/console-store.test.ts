import { describe, expect, it } from 'vitest';
import { createConsoleStore, formatConsoleSnippet, type ConsoleEntry } from './console-store';

describe('Console Store', () => {
  it('pushes entries and clears correctly', () => {
    const store = createConsoleStore();
    expect(store.get()).toHaveLength(0);

    store.push('log', 'Hello world', 'runner');
    store.push('error', 'Something broke', 'system');

    const entries = store.get();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.text).toBe('Hello world');
    expect(entries[0]!.level).toBe('log');
    expect(entries[1]!.level).toBe('error');

    store.clear();
    expect(store.get()).toHaveLength(0);
  });

  it('formats console snippet for chat broadcast', () => {
    const entry: ConsoleEntry = {
      id: 1,
      level: 'error',
      text: 'Uncaught ReferenceError: foo is not defined',
      at: 1700000000000,
      source: 'runner',
    };

    const formatted = formatConsoleSnippet(entry);
    expect(formatted).toContain('```text');
    expect(formatted).toContain('[Console ERROR');
    expect(formatted).toContain('foo is not defined');
    expect(formatted.endsWith('```')).toBe(true);
  });
});
