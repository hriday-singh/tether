/**
 * Pure TokenBucket implementation with an injectable clock.
 * Used for lossless broadcast throttling and flood protection.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;
  public readonly ratePerSec: number;
  public readonly burst: number;
  private readonly clock: () => number;

  constructor(
    ratePerSec: number,
    burst: number,
    clock: () => number = () => Date.now()
  ) {
    if (ratePerSec <= 0 || burst <= 0) {
      throw new Error('Rate and burst must be greater than 0');
    }
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.clock = clock;
    this.lastRefillAt = this.clock();
  }

  private refill(now: number): void {
    const elapsedMs = Math.max(0, now - this.lastRefillAt);
    const addedTokens = (elapsedMs / 1000) * this.ratePerSec;
    this.tokens = Math.min(this.burst, this.tokens + addedTokens);
    this.lastRefillAt = now;
  }

  /**
   * Attempts to consume `count` tokens.
   * Returns true if tokens were deducted, false otherwise.
   */
  public take(count = 1, now: number = this.clock()): boolean {
    this.refill(now);
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /**
   * Returns the timestamp (in ms) when `count` tokens will become available.
   */
  public nextAvailableAt(count = 1, now: number = this.clock()): number {
    this.refill(now);
    if (this.tokens >= count) {
      return now;
    }
    const needed = count - this.tokens;
    const waitMs = Math.ceil((needed / this.ratePerSec) * 1000);
    return now + waitMs;
  }

  /**
   * Returns current token balance after refilling to `now`.
   */
  public peek(now: number = this.clock()): number {
    this.refill(now);
    return this.tokens;
  }

  /**
   * Resets the bucket to full capacity.
   */
  public reset(now: number = this.clock()): void {
    this.tokens = this.burst;
    this.lastRefillAt = now;
  }
}
