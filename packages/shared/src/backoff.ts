export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  rng?: () => number;
}

/**
 * Calculates exponential backoff with full jitter.
 * delay = rng() * min(maxMs, baseMs * factor^attempt)
 */
export function calculateBackoff(
  attempt: number,
  options: BackoffOptions = {}
): number {
  const {
    baseMs = 500,
    maxMs = 10000,
    factor = 2,
    rng = Math.random,
  } = options;

  if (attempt <= 0) {
    return 0;
  }

  const exponential = baseMs * Math.pow(factor, attempt - 1);
  const ceiling = Math.min(maxMs, exponential);
  const jittered = rng() * ceiling;

  return Math.round(jittered);
}
