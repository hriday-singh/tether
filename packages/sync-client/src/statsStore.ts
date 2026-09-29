export interface LatencyStats {
  p50Ms: number;
  p95Ms: number;
  avgMs: number;
  latestMs: number;
  sampleCount: number;
}

export interface ClientStats {
  rtt: LatencyStats;
  ackLatency: LatencyStats;
}

/**
 * Computes nearest-rank percentile over a sample of values.
 * Returns 0 if values is empty.
 */
export function computePercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[rank] ?? 0;
}

export class StatsStore {
  private rttSamples: number[] = [];
  private ackSamples: number[] = [];
  private listeners = new Set<(stats: ClientStats) => void>();

  constructor(private readonly windowSize: number = 60) {}

  public recordRtt(ms: number): void {
    this.rttSamples.push(Math.round(ms));
    if (this.rttSamples.length > this.windowSize) {
      this.rttSamples.shift();
    }
    this.notify();
  }

  public recordAckLatency(ms: number): void {
    this.ackSamples.push(Math.round(ms));
    if (this.ackSamples.length > this.windowSize) {
      this.ackSamples.shift();
    }
    this.notify();
  }

  public getStats(): ClientStats {
    return {
      rtt: this.summarize(this.rttSamples),
      ackLatency: this.summarize(this.ackSamples),
    };
  }

  private summarize(samples: number[]): LatencyStats {
    if (samples.length === 0) {
      return {
        p50Ms: 0,
        p95Ms: 0,
        avgMs: 0,
        latestMs: 0,
        sampleCount: 0,
      };
    }
    const sum = samples.reduce((acc, v) => acc + v, 0);
    return {
      p50Ms: computePercentile(samples, 50),
      p95Ms: computePercentile(samples, 95),
      avgMs: Math.round(sum / samples.length),
      latestMs: samples[samples.length - 1] ?? 0,
      sampleCount: samples.length,
    };
  }

  public reset(): void {
    this.rttSamples = [];
    this.ackSamples = [];
    this.notify();
  }

  public subscribe(listener: (stats: ClientStats) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const stats = this.getStats();
    for (const listener of this.listeners) {
      listener(stats);
    }
  }
}
