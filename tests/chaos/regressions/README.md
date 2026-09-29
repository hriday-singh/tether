# Chaos Regression Tests

This directory is reserved for permanent regression tests locking in edge cases, race conditions, or invariant violations discovered during stochastic chaos runs or CI fuzzing.

## How to Add a Failing Seed Regression Test

Whenever the chaos harness or CI prints:

```text
======================================================
CHAOS HARNESS INVARIANT FAILURE DETECTED!
To reproduce this exact failure run:
CHAOS_SEED=<seed> pnpm --filter @tether/chaos test
======================================================
```

1. **Verify Local Reproduction:**
   ```bash
   CHAOS_SEED=<seed> pnpm --filter @tether/chaos test
   ```

2. **Create a Dedicated Regression Test:**
   Create a new test file in this directory named `seed-<seed>.test.ts`, using the template below:

   ```typescript
   import { describe, it, expect } from 'vitest';
   import { runChaosSession } from '../src/chaosRunner.js';

   describe('Regression Seed: <seed>', () => {
     it('converges and satisfies all invariants without regressions', async () => {
       const summary = await runChaosSession({
         seed: <seed>,
         numClients: 3,
         steps: 40,
         quiescenceMs: 3000,
       });

       expect(summary.clientsConverged).toBe(3);
       expect(summary.activeTagsCount).toBeGreaterThanOrEqual(0);
       expect(summary.convergedLength).toBeGreaterThanOrEqual(0);
     });
   });
   ```

3. **Diagnose and Fix the Root Cause:**
   - Follow systematic debugging steps: find where the invariant failed (`assertI1Convergence`, `assertI2NoLoss`, `assertI3NoDuplication`, `assertI4ThrottleBound`, `assertDurabilityAndAcks`, or `assertDbReloadMatch`).
   - Fix the bug in `@tether/server` or `@tether/sync-client`.
   - Run the dedicated regression test until it passes.

4. **Keep in CI:**
   The regression test will automatically run with the workspace test suite to prevent regressions.
