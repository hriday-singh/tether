import { describe, it, expect } from 'vitest';
import { calculateBackoff } from './backoff.js';

describe('Exponential Backoff Calculator', () => {
  it('returns 0 for attempt <= 0', () => {
    expect(calculateBackoff(0)).toBe(0);
    expect(calculateBackoff(-1)).toBe(0);
  });

  it('calculates jittered exponential backoff with deterministic RNG', () => {
    // With rng = () => 1.0 (maximum jitter bound)
    const maxRng = () => 1.0;

    // attempt 1: baseMs * 2^0 = 500
    expect(calculateBackoff(1, { baseMs: 500, maxMs: 10000, factor: 2, rng: maxRng })).toBe(500);

    // attempt 2: baseMs * 2^1 = 1000
    expect(calculateBackoff(2, { baseMs: 500, maxMs: 10000, factor: 2, rng: maxRng })).toBe(1000);

    // attempt 3: baseMs * 2^2 = 2000
    expect(calculateBackoff(3, { baseMs: 500, maxMs: 10000, factor: 2, rng: maxRng })).toBe(2000);

    // With rng = () => 0.5 (halfway jitter)
    const halfRng = () => 0.5;
    expect(calculateBackoff(1, { baseMs: 500, maxMs: 10000, factor: 2, rng: halfRng })).toBe(250);
  });

  it('caps at maxMs', () => {
    const maxRng = () => 1.0;
    // attempt 10 would be 500 * 2^9 = 256,000, capped at maxMs 5,000
    const delay = calculateBackoff(10, { baseMs: 500, maxMs: 5000, factor: 2, rng: maxRng });
    expect(delay).toBe(5000);
  });
});
