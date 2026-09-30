import { describe, it, expect, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { createRateLimitHook, clearAllRateLimiters } from './rateLimiter.js';

describe('createRateLimitHook', () => {
  let app: FastifyInstance;
  let currentTime: number;

  beforeEach(async () => {
    clearAllRateLimiters();
    currentTime = 1000000;
    app = fastify({ logger: false });
  });

  it('allows requests within rate and burst limit, sets 429 and Retry-After when exhausted', async () => {
    const hook = createRateLimitHook({
      ratePerSec: 1, // 1 token per sec
      burst: 2,      // 2 tokens initial burst
      clock: () => currentTime,
    });

    app.get('/test', { preHandler: hook }, async (_req, reply) => {
      return reply.send({ success: true });
    });

    // 1st request -> ok
    const res1 = await app.inject({ method: 'GET', url: '/test' });
    expect(res1.statusCode).toBe(200);

    // 2nd request -> ok
    const res2 = await app.inject({ method: 'GET', url: '/test' });
    expect(res2.statusCode).toBe(200);

    // 3rd request -> 429
    const res3 = await app.inject({ method: 'GET', url: '/test' });
    expect(res3.statusCode).toBe(429);
    expect(res3.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Please try again later.',
      },
    });
    expect(res3.headers['retry-after']).toBe('1');

    // Advance clock by 1 second -> should allow 1 request
    currentTime += 1000;
    const res4 = await app.inject({ method: 'GET', url: '/test' });
    expect(res4.statusCode).toBe(200);
  });

  it('supports custom key extractor (e.g. composite IP + roomId or Token)', async () => {
    const hook = createRateLimitHook({
      ratePerSec: 1,
      burst: 1,
      keyExtractor: (req) => {
        const auth = req.headers['authorization'];
        return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
      },
      clock: () => currentTime,
    });

    app.get('/auth-test', { preHandler: hook }, async (_req, reply) => {
      return reply.send({ ok: true });
    });

    // User A
    const resA1 = await app.inject({
      method: 'GET',
      url: '/auth-test',
      headers: { authorization: 'Bearer token-A' },
    });
    expect(resA1.statusCode).toBe(200);

    const resA2 = await app.inject({
      method: 'GET',
      url: '/auth-test',
      headers: { authorization: 'Bearer token-A' },
    });
    expect(resA2.statusCode).toBe(429);

    // User B is isolated
    const resB1 = await app.inject({
      method: 'GET',
      url: '/auth-test',
      headers: { authorization: 'Bearer token-B' },
    });
    expect(resB1.statusCode).toBe(200);
  });

  it('evicts idle buckets after idleTimeoutMs', async () => {
    let now = 1000;
    const hook = createRateLimitHook({
      ratePerSec: 1,
      burst: 1,
      clock: () => now,
      idleTimeoutMs: 5000,
    });

    app.get('/evict-test', { preHandler: hook }, async (_req, reply) => reply.send({ ok: true }));

    // Use token
    await app.inject({ method: 'GET', url: '/evict-test' });
    const blocked = await app.inject({ method: 'GET', url: '/evict-test' });
    expect(blocked.statusCode).toBe(429);

    // Advance beyond idle timeout
    now += 6000;

    // After eviction, bucket is reset to burst
    const allowed = await app.inject({ method: 'GET', url: '/evict-test' });
    expect(allowed.statusCode).toBe(200);
  });
});
