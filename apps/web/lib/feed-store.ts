import { FEED_GAP_FILL_MAX, type AuditEvent } from '@tether/shared';
import { createStore, type ReadableStore } from './store';

export interface FeedSnapshot<T extends { seq: number } = AuditEvent> {
  /** Newest first. */
  items: readonly T[];
  highest: number;
}

/**
 * Activity feed (and chat, ADR-017) merged from REST pages + live pushes, keyed by per-room seq (docs/04 "no duplicates, no gaps").
 * The same seq from both paths is stored once. Holes are reported by `gapAfter()` for the caller to fill.
 */
export class FeedStore<T extends { seq: number } = AuditEvent> {
  private bySeq = new Map<number, T>();
  /** Seqs a server page proved do not exist (holes in the server's sequence): never treated as gaps. */
  private absent = new Set<number>();
  private readonly store = createStore<FeedSnapshot<T>>({ items: [], highest: 0 });
  readonly snapshot: ReadableStore<FeedSnapshot<T>> = this.store;

  add(events: readonly T[]): void {
    let changed = false;
    for (const e of events) {
      if (!this.bySeq.has(e.seq)) {
        this.bySeq.set(e.seq, e);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  /**
   * Adds an `after=` page and records the seqs it proves missing. `complete` (page shorter than the limit)
   * means nothing else exists up to `serverSeq`, so the tail is settled too.
   */
  fill(after: number, items: readonly T[], complete: boolean, serverSeq = 0): void {
    const got = new Set(items.map((i) => i.seq));
    const last = items.length > 0 ? Math.max(...got) : after;
    const end = complete ? Math.max(last, serverSeq) : last;
    for (let s = after + 1; s <= end; s++) {
      if (!got.has(s) && !this.bySeq.has(s)) this.absent.add(s);
    }
    this.add(items);
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
    const seqs = [...this.bySeq.keys(), ...this.absent].sort((a, b) => a - b);
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
    this.absent.clear();
    this.publish();
  }

  private publish(): void {
    const items = [...this.bySeq.values()].sort((a, b) => b.seq - a.seq);
    this.store.set({ items, highest: items[0]?.seq ?? 0 });
  }
}

const FILL_PAGE = 100;

/** Fetches `after=` pages until no hole is left. Stops on a failed fetch, cancellation, or a page that makes no progress. */
export async function fillGaps<T extends { seq: number }>(
  feed: FeedStore<T>,
  serverSeq: number,
  fetchAfter: (after: number, limit: number) => Promise<{ items: readonly T[] } | null>,
  cancelled: () => boolean,
): Promise<void> {
  let after = feed.gapAfter(serverSeq);
  while (after !== null && !cancelled()) {
    const page = await fetchAfter(after, FILL_PAGE);
    if (!page || cancelled()) return;
    feed.fill(after, page.items, page.items.length < FILL_PAGE, serverSeq);
    const next = feed.gapAfter(serverSeq);
    if (next === after) return;
    after = next;
  }
}
