/**
 * FIFO delay line for the simulated-latency lab. Every task runs `delayMs` after it was queued and never
 * before a task queued earlier, so lowering the delay mid-stream cannot reorder frames.
 * At 0 ms with nothing queued, tasks run synchronously (zero overhead in normal use).
 */
export class DelayLine {
  private delayMs = 0;
  private lastAt = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  public get delay(): number {
    return this.delayMs;
  }

  public setDelay(ms: number): void {
    this.delayMs = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  }

  public run(task: () => void): void {
    if (this.delayMs === 0 && this.timers.size === 0) {
      task();
      return;
    }
    const now = Date.now();
    const at = Math.max(now + this.delayMs, this.lastAt);
    this.lastAt = at;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      task();
    }, at - now);
    this.timers.add(timer);
  }

  /** Drops everything still queued (socket closed: reconnect resyncs via step1/step2). */
  public clear(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.lastAt = 0;
  }
}
