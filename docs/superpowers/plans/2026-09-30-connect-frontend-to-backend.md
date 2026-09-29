# Connect Frontend to Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Next.js frontend (`apps/web`) to the Fastify + WebSocket backend (`apps/server`) and client sync engine (`packages/sync-client`), replacing browser-local simulation with live client-server CRDT synchronization and REST persistence.

**Architecture:**
- `packages/sync-client`: Enhance `SyncClient` with awareness broadcast forwarding, control command promises (`ok`/`error`), `onRoomUpdated`, and `onEvent` handlers.
- `apps/web/lib/api`: Implement `FetchApi` conforming to the `Api` interface, issuing standard HTTP `fetch` requests to `NEXT_PUBLIC_API_URL` (`http://localhost:4000`), selected when `NEXT_PUBLIC_SYNC_MODE === 'server'`.
- `apps/web/lib/sync`: Implement `ServerSyncClient` conforming to the UI's `SyncClient` interface, wrapping `@tether/sync-client` over WebSocket (`NEXT_PUBLIC_WS_URL`), managing local `Y.Doc`, `Awareness`, and reactive `ReadableStore` state.
- Verification: Monorepo test suite, typecheck, lint, and live end-to-end integration check.

**Tech Stack:** TypeScript (strict), Next.js 16, React 19, Fastify 5, WebSocket (`ws`), Yjs v13, `y-protocols`, `y-indexeddb`, Vitest, Zod.

**Spec:**
- `docs/02-architecture.md`
- `docs/03-sync-engine.md`
- `docs/04-protocol.md`
- `docs/05-rooms-security-roles.md`
- `docs/07-frontend.md`
- `docs/10-roadmap.md` (M2, M3, M9 integration)

## Global Constraints
- TypeScript strict mode enabled everywhere; no `any`.
- Never commit to git (the human operator commits).
- Never run database migrations.
- Keep all files $\le 700$ lines.
- Vitest unit tests for every new module with 100% green run before marking complete.
- Re-run `pnpm --filter @tether/shared build:pkg` and `pnpm --filter @tether/sync-client build:pkg` whenever shared or sync-client exports change.

---

### Task 1: Milestone M3 — SyncClient Inbound Awareness & Host Command Promises

**Files:**
- Modify: `packages/sync-client/src/syncClient.ts`
- Modify: `packages/sync-client/src/syncClient.test.ts`

**Interfaces:**
- Consumes:
  - `FRAME_KINDS.UPDATE` with `awarenessUpdate: Uint8Array` from `@tether/shared/protocol/codec`
  - `ServerOkSchema`, `ServerErrorSchema`, `ServerRoomUpdatedSchema`, `ServerEventSchema` from `@tether/shared/protocol/schemas`
- Produces:
  - `SyncClientOptions.onAwarenessUpdate?: (update: Uint8Array) => void`
  - `SyncClientOptions.onRoomUpdate?: (settings: { locked?: boolean; hasPasscode?: boolean; language?: string }) => void`
  - `SyncClientOptions.onEvent?: (event: AuditEvent) => void`
  - `SyncClient.prototype.command(cmd: ClientControlMessage & { rid: string }): Promise<void>`

- [ ] **Step 1: Write unit tests in `packages/sync-client/src/syncClient.test.ts`**
  Add tests verifying:
  1. Inbound `FRAME_KINDS.UPDATE` with non-empty `awarenessUpdate` triggers `onAwarenessUpdate`.
  2. Inbound control messages:
     - `t: 'room.updated'` triggers `onRoomUpdate` and updates `room` metadata.
     - `t: 'event'` triggers `onEvent`.
     - `t: 'ok'` with matching `rid` resolves pending `command(cmd)`.
     - `t: 'error'` with matching `rid` rejects pending `command(cmd)`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/sync-client test`
  Expected: FAIL on new command and awareness tests.

- [ ] **Step 3: Implement awareness handling & command dispatch in `syncClient.ts`**
  - Add optional callbacks to `SyncClientOptions`: `onAwarenessUpdate`, `onRoomUpdate`, `onEvent`.
  - Maintain `pendingCommands = new Map<string, { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()`.
  - In `handleBinaryFrame`: if `frame.awarenessUpdate?.byteLength > 0`, call `this.onAwarenessUpdate?.(frame.awarenessUpdate)`.
  - In `handleControlMessage`: handle `ok`, `error`, `room.updated`, and `event`.
  - Implement `command(cmd)`: send control message and return Promise with 5,000ms timeout.
  - In `destroy()`: reject any pending command promises and clear timers.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/sync-client test`
  Expected: PASS

- [ ] **Step 5: Build package**
  Run: `pnpm --filter @tether/sync-client build:pkg`

---

### Task 2: Milestone M2/M9 — Fetch-Based HTTP REST Client in `apps/web`

**Files:**
- Create: `apps/web/lib/api/fetch-client.ts`
- Create: `apps/web/lib/api/fetch-client.test.ts`
- Modify: `apps/web/lib/api/index.ts`

**Interfaces:**
- Consumes:
  - `Api`, `CreateRoomInput`, `JoinRoomInput`, `RoomInfo`, `JoinResult`, `EventsQuery`, `EventsPage`, `AdmissionStatus`, `ApiError` from `apps/web/lib/api/types.ts`
- Produces:
  - `fetchApi: Api` exported in `apps/web/lib/api/fetch-client.ts`
  - Dynamic export `api: Api` in `apps/web/lib/api/index.ts` selecting `fetchApi` when `NEXT_PUBLIC_SYNC_MODE === 'server'`.

- [ ] **Step 1: Write unit tests in `apps/web/lib/api/fetch-client.test.ts`**
  Mock global `fetch` with Vitest and test:
  1. `createRoom`: sends `POST /api/rooms` with body, `Idempotency-Key` header, returns `JoinResult`, handles 409 `room_taken` with suggestion.
  2. `getRoom`: sends `GET /api/rooms/:id`, returns `RoomInfo`, handles 404 with `ApiError('not_found')`.
  3. `joinRoom`: sends `POST /api/rooms/:id/join` with body, returns `JoinResult`, handles 401 `bad_passcode` and 403 `locked`/`banned`.
  4. `events`: sends `GET /api/rooms/:id/events` with `Authorization: Bearer <token>`, returns `EventsPage`.
  5. `admission`: sends `GET /api/rooms/:id/admission` with `Authorization: Bearer <token>`, returns `AdmissionStatus`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/web test lib/api/fetch-client.test.ts`
  Expected: FAIL (file does not exist).

- [ ] **Step 3: Implement `fetchApi` in `apps/web/lib/api/fetch-client.ts`**
  - Read `NEXT_PUBLIC_API_URL || 'http://localhost:4000'`.
  - Implement standard request helper translating non-2xx responses into `ApiError` instances matching `ApiErrorCode`.
  - Implement `createRoom`, `getRoom`, `joinRoom`, `events`, `admission`.
  - Update `apps/web/lib/api/index.ts`:
    ```typescript
    import { fakeApi } from '../fake/api';
    import { fetchApi } from './fetch-client';
    import type { Api } from './types';

    export * from './types';

    export const api: Api =
      process.env.NEXT_PUBLIC_SYNC_MODE === 'server' ? fetchApi : fakeApi;

    export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
    ```

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/web test lib/api/fetch-client.test.ts`
  Expected: PASS

---

### Task 3: Milestone M3/M9 — ServerSyncClient Adapter in `apps/web`

**Files:**
- Create: `apps/web/lib/sync/server-sync-client.ts`
- Create: `apps/web/lib/sync/server-sync-client.test.ts`
- Modify: `apps/web/lib/sync/index.ts`

**Interfaces:**
- Consumes:
  - `SyncClient as ProtocolSyncClient` from `@tether/sync-client`
  - `SyncClient` (UI interface), `StatusSnapshot`, `StatsSnapshot`, `RoomState`, `PresenceSnapshot`, `SyncCommand` from `apps/web/lib/sync/types.ts`
  - `createStore` from `apps/web/lib/store.ts`
  - `Awareness` from `y-protocols/awareness`
  - `IndexeddbPersistence` from `y-indexeddb`
- Produces:
  - `ServerSyncClient` implementing `SyncClient`
  - `createSyncClient` updated to return `new ServerSyncClient(opts)` when `NEXT_PUBLIC_SYNC_MODE === 'server'`.

- [ ] **Step 1: Write unit tests in `apps/web/lib/sync/server-sync-client.test.ts`**
  Test:
  1. Instantiation creates `doc`, `text`, `awareness`, and reactive stores (`status`, `stats`, `roster`, `room`, `presence`).
  2. Awareness bridge: local awareness changes invoke `syncClient.queueAwarenessUpdate`.
  3. Status updates: connection status changes propagate to the `status` store.
  4. Roster & room updates: changes from server update `roster` and `room` stores.
  5. `command`: forwards commands with UUID `rid` to protocol client.
  6. `leave` and `destroy`: cleanup sockets and local listeners.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/web test lib/sync/server-sync-client.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `ServerSyncClient` in `apps/web/lib/sync/server-sync-client.ts`**
  - Implement full `SyncClient` interface from `types.ts`.
  - Connect `IndexeddbPersistence` if running in browser environment.
  - Forward local doc updates and awareness updates to `ProtocolSyncClient`.
  - Apply incoming awareness updates via `applyAwarenessUpdate`.
  - Populate presence snapshot map from awareness states.
  - Forward `command(cmd)` to `protocolClient.command(...)`.
  - Update `apps/web/lib/sync/index.ts`:
    ```typescript
    import { FakeSyncClient, type FakeSyncOptions } from '../fake/fake-sync-client';
    import { ServerSyncClient, type ServerSyncOptions } from './server-sync-client';
    import type { SyncClient } from './types';

    export * from './types';

    export function createSyncClient(opts: FakeSyncOptions & ServerSyncOptions): SyncClient {
      if (process.env.NEXT_PUBLIC_SYNC_MODE === 'server') {
        return new ServerSyncClient(opts);
      }
      return new FakeSyncClient(opts);
    }
    ```

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/web test lib/sync/server-sync-client.test.ts`
  Expected: PASS

---

### Task 4: Full System Verification & Monorepo Health Check

**Files:**
- Inspect: All packages

- [ ] **Step 1: Monorepo test suite**
  Run: `pnpm test`
  Expected: All tests pass across `@tether/shared`, `@tether/server`, `@tether/sync-client`, `@tether/web`, and `@tether/chaos`.

- [ ] **Step 2: TypeScript compilation**
  Run: `pnpm typecheck`
  Expected: Clean compilation with 0 errors across all workspaces.

- [ ] **Step 3: Lint check**
  Run: `pnpm lint`
  Expected: Clean lint run.

- [ ] **Step 4: Integration verification**
  Run chaos tests: `pnpm chaos:ci`
  Expected: Convergence verified under network faults.
