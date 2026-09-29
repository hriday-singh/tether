export interface FaultyTransportOptions {
  minLatencyMs?: number;
  maxLatencyMs?: number;
  dropRate?: number;
  rng?: () => number;
}

export type MessageHandler = (data: Uint8Array | string) => void;

/**
 * FaultyTransport wraps a message channel to simulate realistic network faults:
 * ordered latency jitter, pauses (slow consumers), and abrupt kills,
 * while strictly preserving FIFO packet ordering (TCP semantics).
 */
export class FaultyTransport {
  private queue: Array<{
    data: Uint8Array | string;
    deliverAt: number;
  }> = [];
  private isPaused = false;
  private isDead = false;
  private timer: NodeJS.Timeout | null = null;
  private onMessageCallback: MessageHandler | null = null;
  private onCloseCallback: (() => void) | null = null;

  public minLatencyMs: number;
  public maxLatencyMs: number;
  private rng: () => number;

  constructor(options: FaultyTransportOptions = {}) {
    this.minLatencyMs = options.minLatencyMs ?? 0;
    this.maxLatencyMs = options.maxLatencyMs ?? 0;
    this.rng = options.rng ?? Math.random;
  }

  public onMessage(cb: MessageHandler): void {
    this.onMessageCallback = cb;
  }

  public onClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  /**
   * Enqueues data for delivery with simulated latency.
   * Ensures that deliverAt is monotonically increasing to prevent TCP packet reordering.
   */
  public send(data: Uint8Array | string): void {
    if (this.isDead) {
      return;
    }

    const now = Date.now();
    const delay =
      this.minLatencyMs === this.maxLatencyMs
        ? this.minLatencyMs
        : this.minLatencyMs +
          Math.round(this.rng() * (this.maxLatencyMs - this.minLatencyMs));

    let deliverAt = now + delay;
    const lastItem = this.queue[this.queue.length - 1];
    if (lastItem && deliverAt < lastItem.deliverAt) {
      // Preserve TCP FIFO ordering: subsequent packet cannot arrive before preceding packet
      deliverAt = lastItem.deliverAt;
    }

    this.queue.push({ data, deliverAt });
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.isPaused || this.isDead || this.queue.length === 0 || this.timer) {
      return;
    }

    const now = Date.now();
    const first = this.queue[0];
    if (!first) {
      return;
    }

    const waitMs = Math.max(0, first.deliverAt - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, waitMs);
  }

  private drain(): void {
    if (this.isPaused || this.isDead) {
      return;
    }

    const now = Date.now();
    while (this.queue.length > 0) {
      const first = this.queue[0];
      if (!first || first.deliverAt > now) {
        break;
      }
      this.queue.shift();
      if (this.onMessageCallback) {
        this.onMessageCallback(first.data);
      }
    }

    if (this.queue.length > 0) {
      this.scheduleDrain();
    }
  }

  public pause(): void {
    this.isPaused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public resume(): void {
    if (!this.isPaused) {
      return;
    }
    this.isPaused = false;
    this.scheduleDrain();
  }

  /**
   * Abruptly kills the transport without delivering queued messages.
   */
  public kill(): void {
    this.isDead = true;
    this.queue = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  public get pendingCount(): number {
    return this.queue.length;
  }
}
