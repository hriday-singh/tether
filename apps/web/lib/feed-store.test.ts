import type { AuditEvent } from '@tether/shared';
import { FeedStore } from './feed-store';

const ev = (seq: number): AuditEvent => ({
  id: seq,
  seq,
  roomId: 'r',
  type: 'member.joined',
  actorMemberId: null,
  actorName: null,
  payload: {},
  createdAt: new Date(0).toISOString(),
});

describe('FeedStore', () => {
  it('dedupes the same seq arriving via REST and live push, newest first', () => {
    const f = new FeedStore();
    f.add([ev(1), ev(2)]);
    f.add([ev(2), ev(3)]);
    expect(f.snapshot.get().items.map((e) => e.seq)).toEqual([3, 2, 1]);
  });

  it('does not publish a new snapshot when nothing changed', () => {
    const f = new FeedStore();
    f.add([ev(1)]);
    const before = f.snapshot.get();
    f.add([ev(1)]);
    expect(f.snapshot.get()).toBe(before);
  });

  it('reports the first hole and a missing tail from welcome.eventSeq', () => {
    const f = new FeedStore();
    f.add([ev(4), ev(5), ev(8)]);
    expect(f.gapAfter()).toBe(5);
    f.add([ev(6), ev(7)]);
    expect(f.gapAfter()).toBeNull();
    expect(f.gapAfter(10)).toBe(8);
  });

  it('asks for a reset when the gap is too large to fill', () => {
    const f = new FeedStore();
    f.add([ev(1)]);
    expect(f.shouldResetFor(400)).toBe(false);
    expect(f.shouldResetFor(10_000)).toBe(true);
  });
});
