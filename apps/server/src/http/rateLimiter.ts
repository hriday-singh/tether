import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { TokenBucket } from '@tether/shared/tokenBucket';

export interface RateLimitOptions {
  ratePerSec: number;
  burst: number;
  keyExtractor?: (req: FastifyRequest) => string | null;
  clock?: () => number;
  idleTimeoutMs?: number; // default: 5 minutes (300_000 ms)
}

interface BucketEntry {
  bucket: TokenBucket;
  lastSeenAt: number;
}

const allLimiterBuckets = new Set<Map<string, BucketEntry>>();

export function clearAllRateLimiters(): void {
  for (const map of allLimiterBuckets) {
    map.clear();
  }
}

export function defaultIpKeyExtractor(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.ip || request.socket.remoteAddress || 'unknown';
}

export function createRateLimitHook(options: RateLimitOptions): preHandlerHookHandler {
  const {
    ratePerSec,
    burst,
    keyExtractor = defaultIpKeyExtractor,
    clock = () => Date.now(),
    idleTimeoutMs = 300_000,
  } = options;

  const buckets = new Map<string, BucketEntry>();
  allLimiterBuckets.add(buckets);

  let lastCleanup = clock();

  const cleanupStaleBuckets = (now: number) => {
    if (now - lastCleanup < 60_000) return;
    lastCleanup = now;
    for (const [key, entry] of buckets.entries()) {
      if (now - entry.lastSeenAt > idleTimeoutMs) {
        buckets.delete(key);
      }
    }
  };

  return async function rateLimitHook(request: FastifyRequest, reply: FastifyReply) {
    const now = clock();
    cleanupStaleBuckets(now);

    const key = keyExtractor(request);
    if (!key) {
      // If keyExtractor returns null/empty, skip rate limiting for this request
      return;
    }

    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        bucket: new TokenBucket(ratePerSec, burst, clock),
        lastSeenAt: now,
      };
      buckets.set(key, entry);
    } else if (now - entry.lastSeenAt > idleTimeoutMs) {
      // Reset bucket if it has been idle beyond timeout
      entry.bucket.reset(now);
    }

    entry.lastSeenAt = now;

    if (!entry.bucket.take(1, now)) {
      const nextAvail = entry.bucket.nextAvailableAt(1, now);
      const retryAfterSec = Math.max(1, Math.ceil((nextAvail - now) / 1000));
      reply.header('Retry-After', retryAfterSec.toString());
      return reply.status(429).send({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Please try again later.',
        },
      });
    }
  };
}
