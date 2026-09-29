import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { OutboundThrottle } from './outboundThrottle.js';

describe('OutboundThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('broadcasts bursts up to 5 immediately and throttles the 6th', () => {
    const broadcasts: Uint8Array[] = [];
    let throttledNotices = 0;
    let now = 1000;

    const throttle = new OutboundThrottle({
      ratePerSec: 5,
      burst: 5,
      clock: () => now,
      broadcastFn: (doc) => {
        broadcasts.push(doc);
      },
      onThrottledNotice: () => {
        throttledNotices++;
      },
    });

    // Send 5 updates -> all 5 should broadcast immediately
    for (let i = 0; i < 5; i++) {
      const doc = new Y.Doc();
      doc.getText('t').insert(0, `edit-${i}`);
      throttle.enqueue(Y.encodeStateAsUpdate(doc), new Uint8Array(0));
    }

    expect(broadcasts.length).toBe(5);
    expect(throttledNotices).toBe(0);

    // Send 6th update immediately -> bucket is empty!
    const doc6 = new Y.Doc();
    doc6.getText('t').insert(0, 'edit-5');
    throttle.enqueue(Y.encodeStateAsUpdate(doc6), new Uint8Array(0));

    expect(broadcasts.length).toBe(5); // Not sent yet!
    expect(throttledNotices).toBe(1);

    // Also enqueue 7th update while waiting
    const doc7 = new Y.Doc();
    doc7.getText('t').insert(0, 'edit-6');
    throttle.enqueue(Y.encodeStateAsUpdate(doc7), new Uint8Array(0));

    // Advance time by 200ms (1 token replenished at rate = 5/s)
    now += 200;
    vi.advanceTimersByTime(200);

    // 6th and 7th were merged and flushed as 1 combined broadcast!
    expect(broadcasts.length).toBe(6);

    // Verify merged update can be applied
    const targetDoc = new Y.Doc();
    Y.applyUpdate(targetDoc, broadcasts[5]!);
    expect(targetDoc.getText('t').toString()).toContain('edit-5');
    expect(targetDoc.getText('t').toString()).toContain('edit-6');

    throttle.destroy();
  });
});
