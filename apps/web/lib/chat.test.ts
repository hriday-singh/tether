import type { ChatMessage } from '@tether/shared';
import { describe, expect, it } from 'vitest';
import { buildChatRows, CHAT_GROUP_MS, type PendingChat } from './chat';
import { FeedStore } from './feed-store';

const T0 = Date.parse('2026-09-30T10:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const msg = (seq: number, memberId: string, ms: number): ChatMessage => ({
  id: seq,
  roomId: 'r',
  seq,
  clientMsgId: `c${seq}`,
  memberId,
  name: memberId.toUpperCase(),
  colorIndex: 1,
  text: `m${seq}`,
  createdAt: at(ms),
});
const self = { id: 'me', name: 'Me', colorIndex: 4 };

describe('buildChatRows', () => {
  it('returns newest first and groups runs by author', () => {
    // FeedStore order: newest first.
    const rows = buildChatRows([msg(3, 'b', 2000), msg(2, 'a', 1000), msg(1, 'a', 0)], [], self);
    expect(rows.map((r) => r.text)).toEqual(['m3', 'm2', 'm1']);
    expect(rows.map((r) => r.head)).toEqual([true, false, true]);
  });

  it('starts a new group after a long pause by the same author', () => {
    const rows = buildChatRows([msg(2, 'a', CHAT_GROUP_MS + 1), msg(1, 'a', 0)], [], self);
    expect(rows.map((r) => r.head)).toEqual([true, true]);
  });

  it('appends pending messages as self, newest, and hides them once confirmed', () => {
    const pending: PendingChat[] = [
      { clientMsgId: 'c2', text: 'm2', createdAt: at(10), state: 'sending' },
      { clientMsgId: 'p1', text: 'draft', createdAt: at(20), state: 'failed', error: 'rate_limited' },
    ];
    const rows = buildChatRows([{ ...msg(2, 'me', 10) }, msg(1, 'a', 0)], pending, self);
    expect(rows.map((r) => [r.text, r.state])).toEqual([
      ['draft', 'failed'],
      ['m2', 'sent'],
      ['m1', 'sent'],
    ]);
    expect(rows[0]).toMatchObject({ memberId: 'me', name: 'Me', colorIndex: 4, error: 'rate_limited', head: false });
  });
});

describe('FeedStore<ChatMessage>', () => {
  it('dedupes live + REST copies and reports gaps by chat seq', () => {
    const feed = new FeedStore<ChatMessage>();
    feed.add([msg(1, 'a', 0), msg(2, 'a', 1)]);
    feed.add([msg(2, 'a', 1), msg(4, 'b', 3)]);
    expect(feed.snapshot.get().items.map((m) => m.seq)).toEqual([4, 2, 1]);
    expect(feed.gapAfter(4)).toBe(2);
    feed.add([msg(3, 'a', 2)]);
    expect(feed.gapAfter(6)).toBe(4);
  });
});
