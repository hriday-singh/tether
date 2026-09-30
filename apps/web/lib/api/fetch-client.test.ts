import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchApi } from './fetch-client';
import { ApiError } from './types';

describe('fetchApi', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('createRoom sends POST with Idempotency-Key header and returns JoinResult', async () => {
    const mockJoinResult = {
      room: { id: 'room-1', epoch: '11111111-1111-1111-1111-111111111111', language: 'typescript', locked: false, hasPasscode: false },
      token: 'jwt.token.here',
      memberId: 'mem-1',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => mockJoinResult,
    } as Response);

    const result = await fetchApi.createRoom(
      { name: 'Alice', roomId: 'room-1', language: 'typescript' },
      'idem-key-1',
    );

    expect(result).toEqual(mockJoinResult);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/rooms',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-key-1',
        },
      }),
    );
  });

  it('createRoom handles 409 room_taken with suggestion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: 'room_taken', message: 'Room taken', suggestion: 'room-1-42' },
      }),
    } as Response);

    await expect(
      fetchApi.createRoom({ name: 'Alice', roomId: 'room-1', language: 'typescript' }, 'key'),
    ).rejects.toThrow(ApiError);

    try {
      await fetchApi.createRoom({ name: 'Alice', roomId: 'room-1', language: 'typescript' }, 'key');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('room_taken');
      expect(err.status).toBe(409);
      expect(err.details.suggestion).toBe('room-1-42');
    }
  });

  it('getRoom returns RoomInfo on 200 and throws not_found on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'room-1', hasPasscode: false, locked: false, memberCount: 2, language: 'javascript' }),
    } as Response);

    const info = await fetchApi.getRoom('room-1');
    expect(info.id).toBe('room-1');

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'not_found', message: 'Not found' } }),
    } as Response);

    await expect(fetchApi.getRoom('missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('joinRoom handles 200, 401 bad_passcode, and 403 locked/banned', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'invalid_passcode', message: 'Wrong passcode' } }),
    } as Response);

    await expect(fetchApi.joinRoom('room-1', { name: 'Bob', passcode: 'wrong' })).rejects.toMatchObject({
      code: 'bad_passcode',
      status: 401,
    });

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'banned', message: 'Banned' } }),
    } as Response);

    await expect(fetchApi.joinRoom('room-1', { name: 'Bob' })).rejects.toMatchObject({
      code: 'banned',
      status: 403,
    });
  });

  it('events and chat send Authorization Bearer header and query params', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], nextBefore: null, nextAfter: null }),
    } as Response);

    await fetchApi.events('room-1', 'token-123', { before: 10, limit: 20 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/rooms/room-1/events?before=10&limit=20',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-123' },
      }),
    );

    await fetchApi.chat('room-1', 'token-123', { after: 5, limit: 10 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/rooms/room-1/chat?after=5&limit=10',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-123' },
      }),
    );
  });

  it('admission sends Bearer token and returns status string', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    } as Response);

    const status = await fetchApi.admission('room-1', 'token-123');
    expect(status).toBe('ok');
  });
});
