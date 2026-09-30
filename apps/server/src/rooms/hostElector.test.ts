import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HostElector, HandoverReason } from './hostElector.js';

describe('HostElector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('elects first joined member as host', () => {
    let hostChange: { hostId: string | null; reason: HandoverReason; prevHostId: string | null } | null = null;
    const elector = new HostElector({
      onHostChanged: (h, r, p) => {
        hostChange = { hostId: h, reason: r, prevHostId: p };
      },
    });

    elector.addMember('alice', 1000);
    expect(elector.hostId).toBe('alice');
    expect(hostChange).toEqual({ hostId: 'alice', reason: 'creator', prevHostId: null });

    // Bob joins later -> alice remains host
    elector.addMember('bob', 2000);
    expect(elector.hostId).toBe('alice');

    elector.destroy();
  });

  it('performs immediate handover on clean leave', () => {
    let hostChange: { hostId: string | null; reason: HandoverReason; prevHostId: string | null } | null = null;
    const elector = new HostElector({
      onHostChanged: (h, r, p) => {
        hostChange = { hostId: h, reason: r, prevHostId: p };
      },
    });

    elector.addMember('alice', 1000);
    elector.addMember('bob', 2000);

    elector.disconnectConnection('alice', true); // clean leave
    expect(elector.hostId).toBe('bob');
    expect(hostChange).toEqual({ hostId: 'bob', reason: 'handover-leave', prevHostId: 'alice' });

    elector.destroy();
  });

  it('preserves host during grace window on abrupt disconnect, and transfers on timeout', () => {
    let hostChange: { hostId: string | null; reason: HandoverReason; prevHostId: string | null } | null = null;
    const elector = new HostElector({
      graceMs: 5000,
      onHostChanged: (h, r, p) => {
        hostChange = { hostId: h, reason: r, prevHostId: p };
      },
    });

    elector.addMember('alice', 1000);
    elector.addMember('bob', 2000);

    // Alice disconnects abruptly (no clean leave)
    elector.disconnectConnection('alice', false);
    // Alice is still host inside grace window!
    expect(elector.hostId).toBe('alice');

    // Advance 3s and Alice reconnects
    vi.advanceTimersByTime(3000);
    elector.addMember('alice', 1000);
    expect(elector.hostId).toBe('alice');

    // Now Alice disconnects abruptly again and doesn't return
    elector.disconnectConnection('alice', false);
    expect(elector.hostId).toBe('alice');

    // Advance 5s (grace expired)
    vi.advanceTimersByTime(5000);
    expect(elector.hostId).toBe('bob');
    expect(hostChange).toEqual({ hostId: 'bob', reason: 'handover-timeout', prevHostId: 'alice' });

    elector.destroy();
  });

  it('supports manual transfer to an active member', () => {
    let hostChange: { hostId: string | null; reason: HandoverReason; prevHostId: string | null } | null = null;
    const elector = new HostElector({
      onHostChanged: (h, r, p) => {
        hostChange = { hostId: h, reason: r, prevHostId: p };
      },
    });

    elector.addMember('alice', 1000);
    elector.addMember('bob', 2000);

    const transferred = elector.manualTransfer('bob');
    expect(transferred).toBe(true);
    expect(elector.hostId).toBe('bob');
    expect(hostChange).toEqual({ hostId: 'bob', reason: 'manual', prevHostId: 'alice' });

    // Fails for non-existent member
    expect(elector.manualTransfer('charlie')).toBe(false);

    elector.destroy();
  });
});
