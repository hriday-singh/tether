import { FEED_GAP_FILL_MAX, type AuditEvent } from '@tether/shared';
import { createStore, type ReadableStore } from './store';

export interface FeedSnapshot {
  /** Newest first. */
  items: readonly AuditEvent[];
  highest: number;
}

/**
 * Activity feed merged from REST pages + live pushes, keyed by per-room seq (docs/04 "no duplicates, no gaps").
 * The same seq from both paths is stored once. Holes are reported by `gapAfter()` for the caller to fill.
 */
export class FeedStore {
  private bySeq = new Map<number, AuditEvent>();
  private readonly store = createStore<FeedSnapshot>({ items: [], highest: 0 });
  readonly snapshot: ReadableStore<FeedSnapshot> = this.store;

  add(events: readonly AuditEvent[]): void {
    let changed = false;
    for (const e of events) {
      if (!this.bySeq.has(e.seq)) {
        this.bySeq.set(e.seq, e);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  get highest(): number {
    return this.store.get().highest;
  }

  /**
   * Seq to fetch `after=` from, or null when there is no hole between known events.
   * `serverSeq` (from welcome) extends the range: missing tail events are a gap too.
   * Only holes above the lowest loaded seq count: older history is lazy-loaded by scrolling, not a gap.
   */
  gapAfter(serverSeq = 0): number | null {
    if (this.bySeq.size === 0) return null;
    const seqs = [...this.bySeq.keys()].sort((a, b) => a - b);
    for (let i = 0; i < seqs.length - 1; i++) {
      if (seqs[i + 1]! !== seqs[i]! + 1) return seqs[i]!;
    }
    const top = seqs.at(-1)!;
    return serverSeq > top ? top : null;
  }

  /** A gap larger than FEED_GAP_FILL_MAX drops the local feed; the caller reloads the newest page. */
  shouldResetFor(serverSeq: number): boolean {
    return this.highest > 0 && serverSeq - this.highest > FEED_GAP_FILL_MAX;
  }

  reset(): void {
    this.bySeq.clear();
    this.publish();
  }

  private publish(): void {
    const items = [...this.bySeq.values()].sort((a, b) => b.seq - a.seq);
    this.store.set({ items, highest: items[0]?.seq ?? 0 });
  }
}
