import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FaultyTransport } from './faultyTransport.js';

describe('FaultyTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers messages immediately when latency is 0', () => {
    const transport = new FaultyTransport({ minLatencyMs: 0, maxLatencyMs: 0 });
    const received: string[] = [];
    transport.onMessage((msg) => received.push(msg as string));

    transport.send('msg-1');
    vi.runAllTimers();

    expect(received).toEqual(['msg-1']);
  });

  it('preserves FIFO ordering under latency jitter', () => {
    // Inject custom RNG that simulates packet 2 wanting lower delay than packet 1
    let callCount = 0;
    const rng = () => {
      callCount++;
      return callCount === 1 ? 1.0 : 0.0; // packet 1 gets max delay, packet 2 gets min delay
    };

    const transport = new FaultyTransport({
      minLatencyMs: 100,
      maxLatencyMs: 500,
      rng,
    });

    const received: string[] = [];
    transport.onMessage((msg) => received.push(msg as string));

    transport.send('first');
    transport.send('second');

    // At 200ms, neither delivered yet because 'first' is at 500ms and 'second' clamped to >= 500ms
    vi.advanceTimersByTime(200);
    expect(received).toEqual([]);

    // Advance to 500ms -> both delivered in original order
    vi.advanceTimersByTime(300);
    expect(received).toEqual(['first', 'second']);
  });

  it('pauses and resumes delivery', () => {
    const transport = new FaultyTransport({ minLatencyMs: 50, maxLatencyMs: 50 });
    const received: string[] = [];
    transport.onMessage((msg) => received.push(msg as string));

    transport.send('paused-msg');
    transport.pause();

    vi.advanceTimersByTime(200);
    expect(received).toEqual([]);

    transport.resume();
    vi.advanceTimersByTime(50);
    expect(received).toEqual(['paused-msg']);
  });

  it('abruptly terminates without delivering pending queue', () => {
    const transport = new FaultyTransport({ minLatencyMs: 100, maxLatencyMs: 100 });
    const received: string[] = [];
    let closed = false;
    transport.onMessage((msg) => received.push(msg as string));
    transport.onClose(() => {
      closed = true;
    });

    transport.send('will-be-dropped');
    transport.kill();

    expect(closed).toBe(true);
    expect(transport.pendingCount).toBe(0);

    vi.advanceTimersByTime(200);
    expect(received).toEqual([]);
  });
});
