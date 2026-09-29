import { describe, it, expect } from 'vitest';
import { PRNG } from './prng.js';

describe('PRNG (Mulberry32)', () => {
  it('produces deterministic numbers from the same seed', () => {
    const prng1 = new PRNG(12345);
    const prng2 = new PRNG(12345);

    const seq1 = [prng1.nextFloat(), prng1.nextInt(0, 100), prng1.nextBool()];
    const seq2 = [prng2.nextFloat(), prng2.nextInt(0, 100), prng2.nextBool()];

    expect(seq1).toEqual(seq2);
  });

  it('produces different numbers from different seeds', () => {
    const prng1 = new PRNG(12345);
    const prng2 = new PRNG(54321);

    expect(prng1.nextFloat()).not.toEqual(prng2.nextFloat());
  });

  it('respects bounds in nextInt(min, max)', () => {
    const prng = new PRNG(999);
    for (let i = 0; i < 100; i++) {
      const val = prng.nextInt(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(15);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('samples elements with pick() and weighted choices with pickWeighted()', () => {
    const prng = new PRNG(42);
    const items = ['a', 'b', 'c'];
    const chosen = prng.pick(items);
    expect(items).toContain(chosen);

    const weighted = [
      { item: 'rare', weight: 1 },
      { item: 'common', weight: 99 },
    ];
    let commonCount = 0;
    for (let i = 0; i < 100; i++) {
      if (prng.pickWeighted(weighted) === 'common') {
        commonCount++;
      }
    }
    expect(commonCount).toBeGreaterThan(80);
  });
});
