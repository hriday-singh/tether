import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { EditSummaryCoalescer } from './editCoalescer.js';

describe('EditSummaryCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accumulates edits and emits summary after 5s idle', () => {
    const emitted: any[] = [];
    const doc = new Y.Doc();

    const coalescer = new EditSummaryCoalescer(doc, {
      idleMs: 5000,
      maxWindowMs: 30000,
      onEmitSummary: (memberId, memberName, summary) => {
        emitted.push({ memberId, memberName, summary });
      },
    });

    // Simulate edit 1 from alice
    coalescer.recordEdit('alice', 'Alice', 10, 0, [1, 2]);
    expect(emitted.length).toBe(0);

    // Advance 3s and edit again
    vi.advanceTimersByTime(3000);
    coalescer.recordEdit('alice', 'Alice', 5, 2, [2, 3]);
    expect(emitted.length).toBe(0);

    // Advance 5s (idle reached)
    vi.advanceTimersByTime(5000);
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      memberId: 'alice',
      memberName: 'Alice',
      summary: {
        inserted: 15,
        deleted: 2,
        lines: [1, 3],
      },
    });

    coalescer.destroy();
  });

  it('flushes summary at max 30s during continuous editing', () => {
    const emitted: any[] = [];
    const doc = new Y.Doc();

    const coalescer = new EditSummaryCoalescer(doc, {
      idleMs: 5000,
      maxWindowMs: 30000,
      onEmitSummary: (memberId, memberName, summary) => {
        emitted.push({ memberId, memberName, summary });
      },
    });

    // Type every 2s for 32 seconds
    for (let t = 0; t <= 32; t += 2) {
      coalescer.recordEdit('bob', 'Bob', 2, 0, [1, 1]);
      vi.advanceTimersByTime(2000);
    }

    // At 30s, max timer should have fired!
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]!.memberId).toBe('bob');
    expect(emitted[0]!.summary.inserted).toBe(30);

    coalescer.destroy();
  });

  it('flushes pending summary immediately on member leave or flushMember', () => {
    const emitted: any[] = [];
    const doc = new Y.Doc();

    const coalescer = new EditSummaryCoalescer(doc, {
      onEmitSummary: (memberId, memberName, summary) => {
        emitted.push({ memberId, memberName, summary });
      },
    });

    coalescer.recordEdit('alice', 'Alice', 8, 3, [5, 5]);
    expect(emitted.length).toBe(0);

    coalescer.flushMember('alice');
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.summary).toEqual({
      inserted: 8,
      deleted: 3,
      lines: [5, 5],
    });

    coalescer.destroy();
  });

  it('automatically observes Y.Text transactions with member origin', () => {
    const emitted: any[] = [];
    const doc = new Y.Doc();
    const yText = doc.getText('codemirror');

    const coalescer = new EditSummaryCoalescer(doc, {
      idleMs: 5000,
      onEmitSummary: (memberId, memberName, summary) => {
        emitted.push({ memberId, memberName, summary });
      },
    });

    // Apply update with origin object representing connection { memberId, name }
    doc.transact(() => {
      yText.insert(0, 'hello\nworld\n');
    }, { memberId: 'charlie', name: 'Charlie' });

    vi.advanceTimersByTime(5000);
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.memberId).toBe('charlie');
    expect(emitted[0]!.summary.inserted).toBe(12);
    expect(emitted[0]!.summary.deleted).toBe(0);
    expect(emitted[0]!.summary.lines).toEqual([1, 3]);

    coalescer.destroy();
  });
  it('observer line ranges match a naive reference on random edits', () => {
    // Reference: split-based line counting, independent of the indexOf helpers.
    const reference = (event: Y.YTextEvent, fullText: string): [number, number, [number, number]] => {
      const lineAt = (pos: number) => fullText.slice(0, pos).split('\n').length;
      let inserted = 0;
      let deleted = 0;
      let minLine = Infinity;
      let maxLine = 1;
      let pos = 0;
      for (const op of event.delta) {
        if (op.retain !== undefined) pos += op.retain;
        else if (op.insert !== undefined) {
          const str = typeof op.insert === 'string' ? op.insert : '';
          inserted += str.length;
          minLine = Math.min(minLine, lineAt(pos));
          maxLine = Math.max(maxLine, lineAt(pos) + str.split('\n').length - 1);
          pos += str.length;
        } else if (op.delete !== undefined) {
          deleted += op.delete;
          minLine = Math.min(minLine, lineAt(pos));
          maxLine = Math.max(maxLine, lineAt(pos));
        }
      }
      return [inserted, deleted, [minLine === Infinity ? 1 : minLine, maxLine]];
    };

    const doc = new Y.Doc();
    const text = doc.getText('codemirror');
    const coalescer = new EditSummaryCoalescer(doc, { onEmitSummary: () => {} });
    const actual: unknown[] = [];
    const expected: unknown[] = [];
    vi.spyOn(coalescer, 'recordEdit').mockImplementation((_m, _n, ins, del, lines) => {
      actual.push([ins, del, lines]);
    });
    text.observe((event) => expected.push(reference(event, text.toString())));

    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const origin = { memberId: 'm1', name: 'M' };
    const remote = new Y.Doc();
    for (let step = 0; step < 400; step++) {
      if (step % 5 === 0) {
        // Remote-style update with a concurrent edit from another doc.
        Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
        const r = remote.getText('codemirror');
        r.insert(rand(r.length + 1), 'r\nq');
        if (r.length > 3) r.delete(rand(r.length - 2), 2);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), origin);
        continue;
      }
      doc.transact(() => {
        for (let k = 0; k <= rand(3); k++) {
          if (text.length > 0 && rand(3) === 0) {
            const at = rand(text.length);
            text.delete(at, 1 + rand(Math.min(5, text.length - at)));
          } else {
            text.insert(rand(text.length + 1), ['a', '\n', 'xy\nz\n', 'line\n'][rand(4)]!);
          }
        }
      }, origin);
    }

    expect(actual.length).toBeGreaterThan(300);
    expect(actual).toEqual(expected);
    coalescer.destroy();
  });
});
