import { beforeEach, describe, expect, it } from 'vitest';
import { sessions } from './session';

describe('sessions storage and recent tracking', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and retrieves a room session', () => {
    sessions.set('room-alpha', { token: 'jwt-123', memberId: 'mem-1', name: 'Asha', epoch: '1' });
    const s = sessions.get('room-alpha');
    expect(s).toEqual({ token: 'jwt-123', memberId: 'mem-1', name: 'Asha', epoch: '1' });
    expect(sessions.lastName()).toBe('Asha');
  });

  it('tracks recent sessions and returns last session', () => {
    sessions.set('room-1', { token: 't1', memberId: 'm1', name: 'User 1', epoch: '1' });
    sessions.set('room-2', { token: 't2', memberId: 'm2', name: 'User 2', epoch: '1' });

    const recent = sessions.recent();
    expect(recent.length).toBe(2);
    expect(recent[0]?.roomId).toBe('room-2');
    expect(recent[0]?.name).toBe('User 2');

    const last = sessions.last();
    expect(last?.roomId).toBe('room-2');
    expect(last?.name).toBe('User 2');
  });

  it('forgets a specific recent session or clears all', () => {
    sessions.set('room-1', { token: 't1', memberId: 'm1', name: 'User 1', epoch: '1' });
    sessions.set('room-2', { token: 't2', memberId: 'm2', name: 'User 2', epoch: '1' });

    sessions.forgetRecent('room-2');
    expect(sessions.recent().map((r) => r.roomId)).toEqual(['room-1']);

    sessions.forgetRecent();
    expect(sessions.recent()).toEqual([]);
  });
});
