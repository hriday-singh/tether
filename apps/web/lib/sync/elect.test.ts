import type { Member } from '@tether/shared';
import { electHost } from './elect';

const m = (id: string, joinedAt: string, extra: Partial<Member> = {}): Member => ({
  id,
  name: id,
  colorIndex: 0,
  joinedAt,
  status: 'active',
  isHost: false,
  isBot: false,
  ...extra,
});

describe('electHost', () => {
  it('picks the earliest joined active human, skipping the leaver, bots and reconnecting rows', () => {
    const members = [
      m('host', '2026-01-01T00:00:00Z'),
      m('bot', '2026-01-01T00:00:01Z', { isBot: true }),
      m('flaky', '2026-01-01T00:00:02Z', { status: 'reconnecting' }),
      m('b', '2026-01-01T00:00:04Z'),
      m('a', '2026-01-01T00:00:04Z'),
    ];
    expect(electHost(members, 'host')).toBe('a');
  });

  it('returns null when nobody can host', () => {
    expect(electHost([m('bot', 'x', { isBot: true })])).toBeNull();
  });
});
