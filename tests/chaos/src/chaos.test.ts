import { describe, it, expect } from 'vitest';
import { runChaosSession } from './chaosRunner.js';

describe('Chaos Harness: Convergence & Invariants under Network Faults', () => {
  const explicitSeed = process.env.CHAOS_SEED ? parseInt(process.env.CHAOS_SEED, 10) : null;
  const seedCount = explicitSeed !== null ? 1 : process.env.CHAOS_SEEDS ? parseInt(process.env.CHAOS_SEEDS, 10) : 3;

  const seedsToRun = explicitSeed !== null
    ? [explicitSeed]
    : Array.from({ length: seedCount }, (_, i) => 1000 + i * 77);

  for (const seed of seedsToRun) {
    it(
      `converges and preserves all invariants (seed: ${seed})`,
      async () => {
        try {
          const summary = await runChaosSession({
            seed,
            numClients: 3,
            steps: 40,
            quiescenceMs: 3000,
          });

          expect(summary.clientsConverged).toBe(3);
          expect(summary.activeTagsCount).toBeGreaterThanOrEqual(0);
          expect(summary.convergedLength).toBeGreaterThanOrEqual(0);
        } catch (err) {
          console.error(`\n======================================================`);
          console.error(`CHAOS HARNESS INVARIANT FAILURE DETECTED!`);
          console.error(`To reproduce this exact failure run:`);
          console.error(`CHAOS_SEED=${seed} pnpm --filter @tether/chaos test`);
          console.error(`======================================================\n`);
          throw err;
        }
      },
      30000
    );
  }
});
