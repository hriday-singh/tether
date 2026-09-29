import * as Y from 'yjs';
import { TokenBucket } from '@tether/shared/tokenBucket';
import { THROTTLE_RATE_PER_SEC, THROTTLE_BURST } from '@tether/shared/constants';

export class OutboundThrottle {
  private bucket: TokenBucket;
  private pendingDocUpdates: Uint8Array[] = [];
  private pendingAwarenessUpdate: Uint8Array = new Uint8Array(0);
  private timer: NodeJS.Timeout | null = null;
  private lastThrottledNoticeAt = -10000;
  private clock: () => number;
  private broadcastFn: (docUpdate: Uint8Array, awarenessUpdate: Uint8Array) => void;
  private onThrottledNotice?: (windowMs: number) => void;

  constructor(options: {
    broadcastFn: (docUpdate: Uint8Array, awarenessUpdate: Uint8Array) => void;
    onThrottledNotice?: (windowMs: number) => void;
    clock?: () => number;
    ratePerSec?: number;
    burst?: number;
  }) {
    this.broadcastFn = options.broadcastFn;
    this.onThrottledNotice = options.onThrottledNotice;
    this.clock = options.clock ?? (() => Date.now());
    this.bucket = new TokenBucket(
      options.ratePerSec ?? THROTTLE_RATE_PER_SEC,
      options.burst ?? THROTTLE_BURST,
      this.clock
    );
  }

  public enqueue(docUpdate: Uint8Array, awarenessUpdate: Uint8Array): void {
    if (docUpdate.byteLength > 0) {
      this.pendingDocUpdates.push(docUpdate);
    }
    if (awarenessUpdate.byteLength > 0) {
      this.pendingAwarenessUpdate = awarenessUpdate;
    }

    const now = this.clock();

    // If bucket has token and no pending flush scheduled, send immediately
    if (this.bucket.take(1, now) && !this.timer) {
      this.flush();
    } else {
      // Throttled: schedule flush when next token is available
      const nextAt = this.bucket.nextAvailableAt(1, now);
      const waitMs = Math.max(0, nextAt - now);

      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, waitMs);
      }

      // Notify sender at most once every 10s
      if (now - this.lastThrottledNoticeAt >= 10000) {
        this.lastThrottledNoticeAt = now;
        this.onThrottledNotice?.(waitMs);
      }
    }
  }

  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pendingDocUpdates.length === 0 && this.pendingAwarenessUpdate.byteLength === 0) {
      return;
    }

    const mergedDoc =
      this.pendingDocUpdates.length > 0
        ? Y.mergeUpdates(this.pendingDocUpdates)
        : new Uint8Array(0);
    const aw = this.pendingAwarenessUpdate;

    this.pendingDocUpdates = [];
    this.pendingAwarenessUpdate = new Uint8Array(0);

    this.broadcastFn(mergedDoc, aw);
  }

  public destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingDocUpdates = [];
  }
}
