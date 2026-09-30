import { describe, it, expect, vi } from 'vitest';
import { probeAdmission } from './admissionProbe.js';

describe('probeAdmission', () => {
  const apiUrl = 'http://localhost:4000';
  const roomId = 'room-123';
  const token = 'mock-jwt-token';

  it('classifies ok response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 'ok' }),
    });

    const result = await probeAdmission(apiUrl, roomId, token, mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ status: 'ok' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/rooms/room-123/admission',
      expect.objectContaining({
        headers: { Authorization: 'Bearer mock-jwt-token' },
      })
    );
  });

  it('classifies reauth response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 'reauth', reason: 'stale_epoch' }),
    });

    const result = await probeAdmission(apiUrl, roomId, token, mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ status: 'reauth', reason: 'stale_epoch' });
  });

  it('classifies banned response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 'banned' }),
    });

    const result = await probeAdmission(apiUrl, roomId, token, mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ status: 'banned' });
  });

  it('classifies locked response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 'locked' }),
    });

    const result = await probeAdmission(apiUrl, roomId, token, mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ status: 'locked' });
  });

  it('classifies full response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 'full' }),
    });

    const result = await probeAdmission(apiUrl, roomId, token, mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ status: 'full' });
  });

  it('classifies 404 response as not_found', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ status: 'not_found' }),
    });

    const result = await probeAdmission(apiUrl, roomId, token, mockFetch as unknown as typeof fetch);
    expect(result).toEqual({ status: 'not_found' });
  });

  it('classifies fetch throw as network_error', async () => {
    const networkError = new Error('Connection refused');
    const mockFetch = vi.fn().mockRejectedValue(networkError);

    const result = await probeAdmission(apiUrl, roomId, token, mockFetch as unknown as typeof fetch);
    expect(result.status).toBe('network_error');
    if (result.status === 'network_error') {
      expect(result.error).toBe(networkError);
    }
  });
});
