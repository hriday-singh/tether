import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { StormResult } from '../sync/types';
import { runStorm } from './storm';

// Deterministic PRNG so a failing run is reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('runStorm', () => {
  it('converges every bot replica with the host under faults, while the host also types', async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'start\n');
    const awareness = new Awareness(doc);
    let result: StormResult | null = null;
    runStorm({
      doc,
      awareness,
      botIds: ['a', 'b', 'c'],
      seconds: 3,
      faults: true,
      rng: mulberry32(42),
      onOps: () => {},
      onDone: (r) => (result = r),
    });
    for (let i = 0; i < 20; i++) {
      doc.getText('content').insert(0, 'h');
      await vi.advanceTimersByTimeAsync(150);
    }
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result).not.toBeNull();
    expect(result!.converged).toBe(true);
    expect(result!.ops).toBeGreaterThan(10);
    awareness.destroy();
    vi.useRealTimers();
  });
});
