import { describe, it, expect } from 'vitest';
import { TokenBucket } from './tokenBucket.js';

describe('TokenBucket', () => {
  it('initializes with burst capacity and handles constructor errors', () => {
    const now = 1000;
    const bucket = new TokenBucket(5, 5, () => now);
    expect(bucket.peek(now)).toBe(5);

    expect(() => new TokenBucket(0, 5)).toThrow();
    expect(() => new TokenBucket(5, 0)).toThrow();
  });

  it('allows consuming tokens up to burst and rejects when exhausted', () => {
    const now = 1000;
    const bucket = new TokenBucket(5, 3, () => now);

    expect(bucket.take(2, now)).toBe(true);
    expect(bucket.peek(now)).toBe(1);
    expect(bucket.take(1, now)).toBe(true);
    expect(bucket.peek(now)).toBe(0);
    expect(bucket.take(1, now)).toBe(false);
  });

  it('refills tokens linearly over time up to burst cap', () => {
    let now = 1000;
    // 5 tokens/sec = 1 token per 200ms
    const bucket = new TokenBucket(5, 5, () => now);

    // Consume all 5
    expect(bucket.take(5, now)).toBe(true);
    expect(bucket.peek(now)).toBe(0);

    // Advance 200ms -> should have 1 token
    now += 200;
    expect(bucket.peek(now)).toBeCloseTo(1, 5);
    expect(bucket.take(1, now)).toBe(true);
    expect(bucket.take(1, now)).toBe(false);

    // Advance 10 seconds -> should cap at burst (5)
    now += 10000;
    expect(bucket.peek(now)).toBe(5);
  });

  it('accurately predicts nextAvailableAt', () => {
    let now = 1000;
    // 2 tokens/sec = 1 token per 500ms
    const bucket = new TokenBucket(2, 2, () => now);

    // Consume all
    expect(bucket.take(2, now)).toBe(true);

    // If we need 1 token, nextAvailableAt should be now + 500ms
    expect(bucket.nextAvailableAt(1, now)).toBe(now + 500);

    // If we need 2 tokens, nextAvailableAt should be now + 1000ms
    expect(bucket.nextAvailableAt(2, now)).toBe(now + 1000);

    // If tokens already available, returns current now
    now += 1000;
    expect(bucket.nextAvailableAt(1, now)).toBe(now);
  });

  it('resets to burst capacity correctly', () => {
    const now = 1000;
    const bucket = new TokenBucket(5, 5, () => now);
    bucket.take(5, now);
    expect(bucket.peek(now)).toBe(0);

    bucket.reset(now);
    expect(bucket.peek(now)).toBe(5);
  });
});
