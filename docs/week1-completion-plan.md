# Week 1 Completion Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all remaining items in Week 1 of `docs/10-roadmap.md` across Milestone M0 (Deployment & CI) and Milestone M3 (Sync Client hardening: Stats Store, Wake Fast Path, Admission Probe classification, and IndexedDB persistence).

**Architecture:** 
1. **M0 Operations & CI:** Provide containerization (`apps/server/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml` with SQLite persistent volume and optional PostgreSQL profile), and GitHub Actions workflow (`.github/workflows/ci.yml`) validating lint, typecheck, unit/integration tests, and chaos fuzzing.
2. **M3 Client Hardening:** Add modular components in `packages/sync-client`:
   - `StatsStore`: rolling RTT and ack latency metrics (p50/p95).
   - `WakeManager`: browser lifecycle hooks (`visibilitychange`, `focus`, `pageshow`, `online`) triggering immediate ping and `WAKE_PROBE_MS` timeout.
   - `AdmissionProbe`: REST probe (`GET /api/rooms/:id/admission`) classifying pre-welcome drops (`reauth`, `banned`, `not_found`, `locked`, `ok`) to preserve local edits on reauth.
   - `IndexedDbStorage`: epoch-scoped local snapshot persistence (`collab:<roomId>:<roomEpoch>`) restoring before connect and clearing on leave/kick/reset.

**Tech Stack:** TypeScript (strict), Node.js, Fastify, Next.js, Yjs, Docker, GitHub Actions, Vitest.

**Spec References:**
- `docs/03-sync-engine.md` (Sections 4.1, 4.2, 4.4, 4.5, 6.2)
- `docs/04-protocol.md` (Limits, Close Codes, Ping/Pong)
- `docs/05-rooms-security-roles.md` (Admission REST Endpoint)
- `docs/09-operations.md` (Docker Compose, Env Vars, CI)
- `docs/10-roadmap.md` (Week 1 checklist)

---

## Global Constraints
- TypeScript strict mode enabled everywhere; no `any`.
- Never commit to git (user commits manually).
- Never apply database migrations (generated files only).
- Keep all files $\le 700$ lines.
- Vitest unit tests for every new module with 100% green run before marking complete.

---

## Detailed Task Breakdown

### Task 1: Milestone M0 — Dockerization & Deployment Configuration
**Files:**
- Create: `apps/server/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `docker-compose.yml`
- Update: `.env.example`

- [x] **Step 1:** Create `apps/server/Dockerfile` with multi-stage build (pnpm install, build packages, run production server).
- [x] **Step 2:** Create `apps/web/Dockerfile` with Next.js standalone output.
- [x] **Step 3:** Create `docker-compose.yml` defining `web` (:3000), `server` (:4000), mounted volume `./data:/data` for SQLite, and an optional `postgres` profile.
- [x] **Step 4:** Verify docker compose syntax and ensure `.env.example` is complete and up-to-date.

---

### Task 2: Milestone M0 — GitHub Actions CI Pipeline
**Files:**
- Create: `.github/workflows/ci.yml`

- [x] **Step 1:** Create `.github/workflows/ci.yml` running on Node 22 with pnpm cache.
- [x] **Step 2:** Configure jobs for:
  - `lint`: `pnpm lint`
  - `typecheck`: `pnpm typecheck`
  - `test`: `pnpm test`
  - `chaos`: `pnpm run chaos:ci`
- [x] **Step 3:** Verify all commands match repository scripts.

---

### Task 3: Milestone M3 — Stats Store (RTT & Ack Latency p50/p95)
**Files:**
- Create: `packages/sync-client/src/statsStore.ts`
- Create: `packages/sync-client/src/statsStore.test.ts`
- Modify: `packages/sync-client/src/syncClient.ts`

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

- [x] **Step 1:** Write unit tests for `StatsStore` in `packages/sync-client/src/statsStore.test.ts` (percentile calculation, sliding window of 60 samples).
- [x] **Step 2:** Implement `StatsStore` in `packages/sync-client/src/statsStore.ts`.
- [x] **Step 3:** Wire `StatsStore` into `SyncClient`: record RTT on `pong` and ack latency on `ack`. Expose `client.stats` and `onStatsChange` callback.
- [x] **Step 4:** Run Vitest to verify all tests pass.

---

### Task 4: Milestone M3 — Wake Fast Path (`WAKE_PROBE_MS`)
**Files:**
- Create: `packages/sync-client/src/wakeManager.ts`
- Create: `packages/sync-client/src/wakeManager.test.ts`
- Modify: `packages/sync-client/src/syncClient.ts`

**Interfaces:**
```typescript
export interface WakeManagerOptions {
  onWakePing: () => void;
  onWakeTimeout: () => void;
  onOffline: () => void;
  probeTimeoutMs?: number; // 2000ms default
}
```

- [x] **Step 1:** Write unit tests for `WakeManager` in `packages/sync-client/src/wakeManager.test.ts` simulating `visibilitychange`, `focus`, `pageshow`, and `online`.
- [x] **Step 2:** Implement `WakeManager` in `packages/sync-client/src/wakeManager.ts`.
- [x] **Step 3:** Integrate `WakeManager` into `SyncClient` (attach in browser environments, trigger immediate ping on wake, force close and zero-backoff reconnect if unacknowledged within 2,000ms, and immediate offline status on `offline` event).
- [x] **Step 4:** Run Vitest to verify all tests pass.

---

### Task 5: Milestone M3 — Pre-Welcome Failure Classification via Admission Probe
**Files:**
- Create: `packages/sync-client/src/admissionProbe.ts`
- Create: `packages/sync-client/src/admissionProbe.test.ts`
- Modify: `packages/sync-client/src/syncClient.ts`

**Interfaces:**
```typescript
export type AdmissionProbeResult =
  | { status: 'ok' }
  | { status: 'reauth' }
  | { status: 'banned' }
  | { status: 'not_found' }
  | { status: 'locked' }
  | { status: 'network_error' };
```

- [ ] **Step 1:** Write unit tests for `probeAdmission` in `packages/sync-client/src/admissionProbe.test.ts`.
- [ ] **Step 2:** Implement `probeAdmission` in `packages/sync-client/src/admissionProbe.ts`.
- [ ] **Step 3:** In `SyncClient.handleClose`, if connection drops before `welcome` while online, invoke `probeAdmission`:
  - `reauth`: emit `onReauthRequired(reason)` and stop reconnect timer while preserving in-memory `Y.Doc`.
  - `banned`: emit `onBanned()` and clear persistence.
  - `not_found`: emit `onRoomNotFound()`.
  - `locked`: emit `onRoomLocked()`.
  - `ok` / `network_error`: proceed with normal exponential backoff.
- [ ] **Step 4:** Run Vitest to verify all tests pass.

---

### Task 6: Milestone M3 — Epoch-Scoped IndexedDB Persistence
**Files:**
- Create: `packages/sync-client/src/indexedDbStorage.ts`
- Create: `packages/sync-client/src/indexedDbStorage.test.ts`
- Modify: `packages/sync-client/src/syncClient.ts`

**Interfaces:**
```typescript
export interface StorageOptions {
  roomId: string;
  roomEpoch: string;
}

export function getStorageKey(roomId: string, roomEpoch: string): string; // collab:<roomId>:<roomEpoch>
export function restoreFromStorage(doc: Y.Doc, roomId: string, roomEpoch: string): Promise<boolean>;
export function persistToStorage(doc: Y.Doc, roomId: string, roomEpoch: string): Promise<void>;
export function clearStorage(roomId: string, roomEpoch: string): Promise<void>;
```

- [ ] **Step 1:** Write unit tests in `packages/sync-client/src/indexedDbStorage.test.ts` with mock IndexedDB (testing restore, update persistence, epoch scoping, and clearing).
- [ ] **Step 2:** Implement `indexedDbStorage.ts` using native IndexedDB primitives (zero external dependency).
- [ ] **Step 3:** Wire storage into `SyncClient` options:
  - If `storage: { roomId, roomEpoch }` provided, restore before handshake or connect.
  - Persist on doc updates.
  - Clear on `kicked`, `4013` (doc reset), or explicit `clearPersistence()`.
- [ ] **Step 4:** Run Vitest to verify all tests pass.

---

### Task 7: Full Verification & Roadmap Update
- [ ] **Step 1:** Run `pnpm test` (all packages and apps).
- [ ] **Step 2:** Run `pnpm run chaos:ci`.
- [ ] **Step 3:** Run `pnpm run bench`.
- [ ] **Step 4:** Run `pnpm typecheck`.
- [ ] **Step 5:** Run `pnpm lint`.
- [ ] **Step 6:** Update `docs/10-roadmap.md` marking all Week 1 checklist items complete.
