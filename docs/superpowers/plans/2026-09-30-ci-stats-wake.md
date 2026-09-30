# CI Pipeline, Sync Client Stats Store & Wake Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub Actions CI Pipeline (`.github/workflows/ci.yml`), Sync Client Stats Store (`packages/sync-client/src/statsStore.ts`), and Wake Fast Path (`packages/sync-client/src/wakeManager.ts`), integrating them into `SyncClient` with full TDD coverage.

**Architecture:**
- CI Pipeline runs parallel jobs on Node 22 with pnpm caching for `lint`, `typecheck`, `test`, and `chaos:ci`.
- `StatsStore` maintains 60-sample sliding windows for RTT and Ack latency, computing nearest-rank percentiles (`p50`, `p95`), mean (`avgMs`), and latest latency, wired directly into `SyncClient`'s `pong` and `ack` handling.
- `WakeManager` listens to browser lifecycle events (`visibilitychange`, `focus`, `pageshow`, `online`, `offline`), triggers immediate pings with a `WAKE_PROBE_MS` (2,000ms) timeout, triggers zero-backoff reconnection on probe failure, and sets immediate offline status.

**Tech Stack:** TypeScript (strict, no `any`), Vitest, GitHub Actions, Yjs, WebSocket.

**Spec:**
- `docs/week1-completion-plan.md`
- `docs/10-roadmap.md`
- `docs/03-sync-engine.md` (Sections 4.1, 4.2, 6.2)
- `docs/04-protocol.md`

## Global Constraints
- TypeScript strict mode enabled everywhere; no `any`.
- Never commit to git.
- Keep all files under 700 lines.
- Vitest unit tests written first (TDD) for every module.
- All test suites, `pnpm typecheck`, and `pnpm lint` must pass before marking tasks complete.

---

### Task 2: Milestone M0 — GitHub Actions CI Pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] **Step 1:** Create `.github/workflows/ci.yml` with triggers for `push` and `pull_request` on `main`, running Node 22 with pnpm caching.
- [x] **Step 2:** Configure jobs: `lint`, `typecheck`, `test` (with `NODE_ENV: test` and `JWT_SECRET`), and `chaos`.
- [x] **Step 3:** Verify YAML formatting and ensure all step commands match repository package scripts.

---

### Task 3: Milestone M3 — Sync Client Stats Store

**Files:**
- Create: `packages/sync-client/src/statsStore.test.ts`
- Create: `packages/sync-client/src/statsStore.ts`
- Modify: `packages/sync-client/src/index.ts`
- Modify: `packages/sync-client/src/syncClient.ts`
- Modify: `packages/sync-client/src/syncClient.test.ts`

**Interfaces:**
```typescript
export interface LatencyStats {
  p50Ms: number;
  p95Ms: number;
  avgMs: number;
  latestMs: number;
  sampleCount: number;
}

export interface ClientStats {
  rtt: LatencyStats;
  ackLatency: LatencyStats;
}
```

- [x] **Step 1: Write failing unit tests for StatsStore**
  Create `packages/sync-client/src/statsStore.test.ts` covering:
  - Empty store returns all zeros.
  - Correct nearest-rank `p50Ms` and `p95Ms` percentiles.
  - Sliding window capping at 60 samples.
  - Subscriptions and reset behavior.
- [x] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/sync-client test statsStore.test.ts`
  Expected: FAIL with module not found.
- [x] **Step 3: Implement minimal StatsStore**
  Create `packages/sync-client/src/statsStore.ts` and export from `packages/sync-client/src/index.ts`.
- [x] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @tether/sync-client test statsStore.test.ts`
  Expected: PASS.
- [x] **Step 5: Wire StatsStore into SyncClient**
  - Record RTT on `pong`.
  - Record Ack latency on `ack`.
  - Expose `client.stats` and notify via `onStatsChange`.
- [x] **Step 6: Update syncClient.test.ts to verify stats integration**
  Add unit tests for `pong` RTT and `ack` latency tracking.

---

### Task 4: Milestone M3 — Wake Fast Path (`WAKE_PROBE_MS`)

**Files:**
- Create: `packages/sync-client/src/wakeManager.test.ts`
- Create: `packages/sync-client/src/wakeManager.ts`
- Modify: `packages/sync-client/src/index.ts`
- Modify: `packages/sync-client/src/syncClient.ts`
- Modify: `packages/sync-client/src/syncClient.test.ts`

**Interfaces:**
```typescript
export interface WakeManagerOptions {
  onWakePing: () => void;
  onWakeTimeout: () => void;
  onOffline: () => void;
  probeTimeoutMs?: number; // 2000ms default
  target?: {
    window?: WakeTarget;
    document?: WakeDocumentTarget;
  };
}
```

- [x] **Step 1: Write failing unit tests for WakeManager**
  Create `packages/sync-client/src/wakeManager.test.ts` simulating:
  - `visibilitychange` (visible vs hidden).
  - `focus`, `pageshow`, and `online` triggering `onWakePing` and probe timer.
  - `onWakeTimeout` firing if probe not cleared within `WAKE_PROBE_MS`.
  - `clearProbe` preventing timeout.
  - `offline` event triggering `onOffline`.
  - `destroy()` detaching all event listeners.
- [x] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/sync-client test wakeManager.test.ts`
  Expected: FAIL with module not found.
- [x] **Step 3: Implement minimal WakeManager**
  Create `packages/sync-client/src/wakeManager.ts` and export from `packages/sync-client/src/index.ts`.
- [x] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @tether/sync-client test wakeManager.test.ts`
  Expected: PASS.
- [x] **Step 5: Integrate WakeManager into SyncClient**
  - Attach in browser environments or with injected targets.
  - Send immediate ping on wake and start probe.
  - Clear probe on `pong`.
  - Force close and reconnect with 0 backoff on wake probe timeout.
  - Set status to `'offline'` and pause reconnect timer on offline event.
- [x] **Step 6: Update syncClient.test.ts to verify wake integration**
  Add unit tests for wake ping, probe timeout reconnect, and offline status.

---

### Task 5: Verification & Documentation

- [x] **Step 1:** Run full test suite: `pnpm test`.
- [x] **Step 2:** Run chaos fuzzer: `pnpm run chaos:ci`.
- [x] **Step 3:** Run typecheck: `pnpm typecheck`.
- [x] **Step 4:** Run linter: `pnpm lint`.
- [x] **Step 5:** Update `docs/week1-completion-plan.md` marking Tasks 2, 3, and 4 complete.
