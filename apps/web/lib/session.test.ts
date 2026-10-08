import { ROOM_EXPIRE_IDLE_MS } from '@tether/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessions } from './session';

describe('sessions storage and recent tracking', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and retrieves a room session', () => {
    sessions.set('room-alpha', { token: 'jwt-123', memberId: 'mem-1', name: 'Laasya', epoch: '1' });
    const s = sessions.get('room-alpha');
    expect(s).toEqual({ token: 'jwt-123', memberId: 'mem-1', name: 'Laasya', epoch: '1' });
    expect(sessions.lastName()).toBe('Laasya');
  });

  it('remembers only the last room, and one forget clears it', () => {
    sessions.set('room-1', { token: 't1', memberId: 'm1', name: 'User 1', epoch: '1' });
    sessions.set('room-2', { token: 't2', memberId: 'm2', name: 'User 2', epoch: '1' });
    expect(sessions.last()).toMatchObject({ roomId: 'room-2', name: 'User 2' });

    sessions.forgetRecent();
    expect(sessions.last()).toBeNull();
    expect(sessions.get('room-1')).not.toBeNull(); // the join token itself is kept
  });

  it('drops the remembered room once the server would have expired it', () => {
    vi.useFakeTimers();
    sessions.set('room-1', { token: 't1', memberId: 'm1', name: 'User 1', epoch: '1' });
    vi.advanceTimersByTime(ROOM_EXPIRE_IDLE_MS - 1);
    expect(sessions.last()?.roomId).toBe('room-1');
    vi.advanceTimersByTime(1);
    expect(sessions.last()).toBeNull();
    vi.useRealTimers();
  });
});
