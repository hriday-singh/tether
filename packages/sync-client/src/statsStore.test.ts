import { describe, it, expect, vi } from 'vitest';
import { StatsStore, computePercentile } from './statsStore.js';

describe('computePercentile', () => {
  it('returns 0 for empty arrays', () => {
    expect(computePercentile([], 50)).toBe(0);
    expect(computePercentile([], 95)).toBe(0);
  });

  it('computes nearest rank percentile for unsorted values', () => {
    const values = [50, 10, 40, 20, 30];
    // Sorted: [10, 20, 30, 40, 50]
    // p50: index ceil(0.50 * 5) - 1 = index 2 -> 30
    // p95: index ceil(0.95 * 5) - 1 = index 4 -> 50
    expect(computePercentile(values, 50)).toBe(30);
    expect(computePercentile(values, 95)).toBe(50);
  });
});

describe('StatsStore', () => {
  it('initializes with zeroed stats when empty', () => {
    const store = new StatsStore();
    const stats = store.getStats();

    expect(stats.rtt).toEqual({
      p50Ms: 0,
      p95Ms: 0,
      avgMs: 0,
      latestMs: 0,
      sampleCount: 0,
    });
    expect(stats.ackLatency).toEqual({
      p50Ms: 0,
      p95Ms: 0,
      avgMs: 0,
      latestMs: 0,
      sampleCount: 0,
    });
  });

  it('records RTT samples and calculates percentiles, average, and latest', () => {
    const store = new StatsStore();
    [50, 10, 40, 20, 30].forEach((v) => store.recordRtt(v));

    const stats = store.getStats();
    expect(stats.rtt.sampleCount).toBe(5);
    expect(stats.rtt.latestMs).toBe(30);
    expect(stats.rtt.p50Ms).toBe(30);
    expect(stats.rtt.p95Ms).toBe(50);
    expect(stats.rtt.avgMs).toBe(30);
  });

  it('records Ack latency samples independently', () => {
    const store = new StatsStore();
    [100, 200, 300].forEach((v) => store.recordAckLatency(v));

    const stats = store.getStats();
    expect(stats.ackLatency.sampleCount).toBe(3);
    expect(stats.ackLatency.latestMs).toBe(300);
    expect(stats.ackLatency.p50Ms).toBe(200);
    expect(stats.ackLatency.p95Ms).toBe(300);
    expect(stats.ackLatency.avgMs).toBe(200);

    // RTT remains empty
    expect(stats.rtt.sampleCount).toBe(0);
  });

  it('caps samples to a sliding window of max size (default 60)', () => {
    const store = new StatsStore(5); // Window size 5 for testing
    for (let i = 1; i <= 10; i++) {
      store.recordRtt(i * 10);
    }

    const stats = store.getStats();
    expect(stats.rtt.sampleCount).toBe(5);
    // Retains [60, 70, 80, 90, 100]
    expect(stats.rtt.latestMs).toBe(100);
    expect(stats.rtt.avgMs).toBe(80);
    expect(stats.rtt.p50Ms).toBe(80);
  });

  it('notifies subscribers on updates and allows unsubscribe', () => {
    const store = new StatsStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.recordRtt(25);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        rtt: expect.objectContaining({ latestMs: 25, sampleCount: 1 }),
      })
    );

    unsubscribe();
    store.recordAckLatency(50);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resets stats back to zero', () => {
    const store = new StatsStore();
    store.recordRtt(40);
    store.recordAckLatency(80);

    store.reset();
    const stats = store.getStats();
    expect(stats.rtt.sampleCount).toBe(0);
    expect(stats.ackLatency.sampleCount).toBe(0);
  });
});
