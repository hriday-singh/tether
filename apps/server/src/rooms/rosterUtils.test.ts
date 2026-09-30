import { describe, it, expect } from 'vitest';
import { disambiguateDisplayNames } from './rosterUtils.js';
import { Member } from '@tether/shared/protocol/schemas';

describe('disambiguateDisplayNames', () => {
  it('leaves unique display names unchanged', () => {
    const members: Member[] = [
      { id: '1', name: 'Alice', colorIndex: 0, joinedAt: '2026-09-30T10:00:00Z', status: 'active', isHost: true, isBot: false },
      { id: '2', name: 'Bob', colorIndex: 1, joinedAt: '2026-09-30T10:01:00Z', status: 'active', isHost: false, isBot: false },
    ];

    const result = disambiguateDisplayNames(members);
    expect(result[0]!.name).toBe('Alice');
    expect(result[1]!.name).toBe('Bob');
  });

  it('suffixes colliding names case-insensitively with (2), (3)', () => {
    const members: Member[] = [
      { id: '1', name: 'Alice', colorIndex: 0, joinedAt: '2026-09-30T10:00:00Z', status: 'active', isHost: true, isBot: false },
      { id: '2', name: 'Bob', colorIndex: 1, joinedAt: '2026-09-30T10:01:00Z', status: 'active', isHost: false, isBot: false },
      { id: '3', name: 'alice', colorIndex: 2, joinedAt: '2026-09-30T10:02:00Z', status: 'active', isHost: false, isBot: false },
      { id: '4', name: 'Alice', colorIndex: 3, joinedAt: '2026-09-30T10:03:00Z', status: 'active', isHost: false, isBot: false },
    ];

    const result = disambiguateDisplayNames(members);
    expect(result[0]!.name).toBe('Alice');
    expect(result[1]!.name).toBe('Bob');
    expect(result[2]!.name).toBe('alice (2)');
    expect(result[3]!.name).toBe('Alice (3)');
  });
});
