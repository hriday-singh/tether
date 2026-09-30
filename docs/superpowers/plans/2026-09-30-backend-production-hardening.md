# Backend Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement HTTP REST rate limiting, bounded persistence buffers with Admission Check 8, an OpenAPI 3.1.0 specification endpoint, and Vitest test timeout stabilization across `@tether/server` and `@tether/shared`.

**Architecture:** 
- In `@tether/shared`, declare persistence queue constants (`PERSIST_MAX_QUEUED_PER_ROOM = 64`, `PERSIST_MAX_BUFFERED_UPDATES = 10_000`).
- In `@tether/server`, extend `PersistenceService` with a global buffer counter, capped at 10,000 updates, and eager flushing at 64 updates per room.
- Wire buffer health into `upgradeGate` (Check 8), `GET /health/ready` (503 `buffer_full`), `GET /api/rooms/:id/admission` (`draining`), and `Room.handleInboundUpdate` (disconnect with code 1012 and audit log).
- Build a generic Fastify rate-limiting `preHandler` hook backed by `@tether/shared`'s `TokenBucket` with LRU/idle cleanup, and apply it to all public and authenticated REST endpoints.
- Generate and expose an OpenAPI 3.1.0 contract at `GET /docs/openapi.json` and static `docs/openapi.json`.
- Stabilize Vitest test execution across the monorepo by setting `testTimeout: 15000` in `vitest.config.ts`.

**Tech Stack:** TypeScript, Node.js 22, Fastify 5, ws, Yjs, Zod, Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-30-backend-production-hardening-design.md`](file:///c:/Users/clash/OneDrive/Desktop/Codes/Web%20apps/aws-vit-project-1/docs/superpowers/specs/2026-09-30-backend-production-hardening-design.md)

## Global Constraints

- Never auto-apply database migrations; only generate migration files if schema changes (no schema changes needed for this plan).
- Never commit directly. Make code changes only; commits are reserved for the user.
- Modularize files such that no single file exceeds 700 lines.
- When modifying `@tether/shared`, always re-run `pnpm --filter @tether/shared build:pkg` so other packages resolve the updated type definitions.
- Strict TypeScript mode enabled; no `any`.
- All tests must pass: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

---

### Task 1: Vitest Timeout Configuration & Shared Persistence Constants

**Files:**
- Modify: `vitest.config.ts:1-8`
- Modify: `packages/shared/src/constants.ts:29-35`
- Test: `packages/shared/src/constants.test.ts`

**Interfaces:**
- Consumes: None
- Produces:
  - `PERSIST_MAX_QUEUED_PER_ROOM`: `number` (value `64`)
  - `PERSIST_MAX_BUFFERED_UPDATES`: `number` (value `10000`)
  - `vitest.config.ts`: `test.testTimeout = 15000`

- [x] **Step 1: Write the failing test for shared persistence constants**

Create `packages/shared/src/constants.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  PERSIST_MAX_QUEUED_PER_ROOM,
  PERSIST_MAX_BUFFERED_UPDATES,
} from './constants.js';

describe('Shared Persistence Constants', () => {
  it('exports bounded persistence buffer limits', () => {
    expect(PERSIST_MAX_QUEUED_PER_ROOM).toBe(64);
    expect(PERSIST_MAX_BUFFERED_UPDATES).toBe(10_000);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tether/shared test`
Expected: FAIL with missing exports `PERSIST_MAX_QUEUED_PER_ROOM` and `PERSIST_MAX_BUFFERED_UPDATES`.

- [x] **Step 3: Implement minimal constants and vitest configuration**

Update `packages/shared/src/constants.ts`:
```typescript
// Lifecycle & Persistence
export const HOST_GRACE_MS = 5000;
export const PERSIST_FLUSH_MS = 250;
export const COMPACT_AFTER_ROWS = 500;
export const ROOM_UNLOAD_IDLE_MS = 30000;
export const PERSIST_MAX_QUEUED_PER_ROOM = 64;
export const PERSIST_MAX_BUFFERED_UPDATES = 10000;
```

Update `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000,
    projects: ['packages/*', 'apps/*', 'tests/*'],
  },
});
```

- [x] **Step 4: Build shared package and run test to verify it passes**

Run: `pnpm --filter @tether/shared build:pkg && pnpm --filter @tether/shared test`
Expected: PASS

---

### Task 2: Bounded Persistence Buffer in `PersistenceService`

**Files:**
- Modify: `apps/server/src/services/persistenceService.ts`
- Test: `apps/server/src/services/persistenceService.test.ts`

**Interfaces:**
- Consumes:
  - `PERSIST_MAX_QUEUED_PER_ROOM` from `@tether/shared/constants`
  - `PERSIST_MAX_BUFFERED_UPDATES` from `@tether/shared/constants`
- Produces:
  - `BufferFullError`: class extending `Error` with `code = 'BUFFER_FULL'`
  - `PersistenceService.prototype.enqueueUpdate(roomId: string, update: Uint8Array, ackRecipient?: AckRecipient): void` (throws `BufferFullError` when full, triggers immediate `flush` when room queue reaches `PERSIST_MAX_QUEUED_PER_ROOM`)
  - `PersistenceService.prototype.isBufferFull(): boolean`
  - `PersistenceService.prototype.getTotalBufferedUpdates(): number`

- [x] **Step 1: Write the failing tests for bounded persistence buffer**

Create `apps/server/src/services/persistenceService.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { PersistenceService, BufferFullError } from './persistenceService.js';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { PERSIST_MAX_QUEUED_PER_ROOM, PERSIST_MAX_BUFFERED_UPDATES } from '@tether/shared/constants';

describe('PersistenceService Bounded Buffer & Eager Flush', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let service: PersistenceService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    roomRepo.createRoom({
      id: 'room-1',
      creator_name: 'Alice',
      epoch: 1,
      passcode_hash: null,
      passcode_version: 0,
      locked: 0,
      language: 'typescript',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    service = new PersistenceService(updateRepo, roomRepo, 1000);
  });

  afterEach(() => {
    service.destroy();
    db.close();
  });

  it('tracks totalBufferedUpdates and decrements on successful flush', () => {
    expect(service.getTotalBufferedUpdates()).toBe(0);
    expect(service.isBufferFull()).toBe(false);

    const doc = new Y.Doc();
    doc.getText('codemirror').insert(0, 'Hello');
    const update1 = Y.encodeStateAsUpdate(doc);

    service.enqueueUpdate('room-1', update1);
    expect(service.getTotalBufferedUpdates()).toBe(1);

    service.flush('room-1');
    expect(service.getTotalBufferedUpdates()).toBe(0);
  });

  it('triggers immediate flush when room queue reaches PERSIST_MAX_QUEUED_PER_ROOM', () => {
    const flushSpy = vi.spyOn(service, 'flush');
    const doc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(doc);

    for (let i = 0; i < PERSIST_MAX_QUEUED_PER_ROOM - 1; i++) {
      service.enqueueUpdate('room-1', update);
    }
    expect(flushSpy).not.toHaveBeenCalled();
    expect(service.getTotalBufferedUpdates()).toBe(PERSIST_MAX_QUEUED_PER_ROOM - 1);

    // 64th update triggers immediate flush
    service.enqueueUpdate('room-1', update);
    expect(flushSpy).toHaveBeenCalledWith('room-1', undefined);
    expect(service.getTotalBufferedUpdates()).toBe(0);
  });

  it('throws BufferFullError and rejects updates when totalBufferedUpdates >= PERSIST_MAX_BUFFERED_UPDATES', () => {
    // Override limit or simulate reaching limit
    const doc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(doc);

    // We can test by calling with an already saturated buffer
    // or configuring / mocking the limit
    (service as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = PERSIST_MAX_BUFFERED_UPDATES;
    expect(service.isBufferFull()).toBe(true);

    expect(() => {
      service.enqueueUpdate('room-1', update);
    }).toThrow(BufferFullError);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tether/server test src/services/persistenceService.test.ts`
Expected: FAIL with `BufferFullError is not defined` and `service.getTotalBufferedUpdates is not a function`.

- [x] **Step 3: Implement bounded buffer in `PersistenceService`**

Modify `apps/server/src/services/persistenceService.ts`:
```typescript
import * as Y from 'yjs';
import { UpdateRepo } from '../repo/updateRepo.js';
import { RoomRepo } from '../repo/roomRepo.js';
import {
  PERSIST_FLUSH_MS,
  COMPACT_AFTER_ROWS,
  PERSIST_MAX_QUEUED_PER_ROOM,
  PERSIST_MAX_BUFFERED_UPDATES,
} from '@tether/shared/constants';

export class BufferFullError extends Error {
  public readonly code = 'BUFFER_FULL';
  constructor(message = 'Persistence buffer is full') {
    super(message);
    this.name = 'BufferFullError';
  }
}

export interface AckRecipient {
  seq: number;
  sendAck: (seq: number) => void;
}

export class PersistenceService {
  private pendingUpdates = new Map<string, Uint8Array[]>();
  private pendingAcks = new Map<string, AckRecipient[]>();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private flushWindowMs: number;
  private totalBufferedUpdates = 0;
  private maxBufferedUpdates: number;

  /** Live doc for a room, so timer flushes can compact while the room stays active (set by RoomRegistry). */
  public resolveDoc?: (roomId: string) => Y.Doc | undefined;

  constructor(
    private updateRepo: UpdateRepo,
    private roomRepo: RoomRepo,
    flushWindowMs = PERSIST_FLUSH_MS,
    maxBufferedUpdates = PERSIST_MAX_BUFFERED_UPDATES
  ) {
    this.flushWindowMs = flushWindowMs;
    this.maxBufferedUpdates = maxBufferedUpdates;
  }

  public isBufferFull(): boolean {
    return this.totalBufferedUpdates >= this.maxBufferedUpdates;
  }

  public getTotalBufferedUpdates(): number {
    return this.totalBufferedUpdates;
  }

  public enqueueUpdate(
    roomId: string,
    update: Uint8Array,
    ackRecipient?: AckRecipient
  ): void {
    if (this.isBufferFull()) {
      throw new BufferFullError();
    }

    let list = this.pendingUpdates.get(roomId);
    if (!list) {
      list = [];
      this.pendingUpdates.set(roomId, list);
    }
    list.push(update);
    this.totalBufferedUpdates++;

    if (ackRecipient) {
      let acks = this.pendingAcks.get(roomId);
      if (!acks) {
        acks = [];
        this.pendingAcks.set(roomId, acks);
      }
      acks.push(ackRecipient);
    }

    if (list.length >= PERSIST_MAX_QUEUED_PER_ROOM) {
      // Eager flush triggers immediately before timer
      this.flush(roomId, this.resolveDoc?.(roomId));
      return;
    }

    if (!this.flushTimers.has(roomId)) {
      const timer = setTimeout(() => {
        this.flushTimers.delete(roomId);
        this.flush(roomId, this.resolveDoc?.(roomId));
      }, this.flushWindowMs);
      this.flushTimers.set(roomId, timer);
    }
  }

  public flush(roomId: string, docForCompaction?: Y.Doc): number {
    const timer = this.flushTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(roomId);
    }

    const updates = this.pendingUpdates.get(roomId);
    if (!updates || updates.length === 0) {
      return 0;
    }

    const acks = this.pendingAcks.get(roomId) ?? [];

    // Merge updates losslessly into one binary payload
    const merged = updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates);

    try {
      const lastId = this.updateRepo.insertBatch(roomId, merged);

      // Decrement buffer count and clean up pending state ONLY after successful DB commit
      this.totalBufferedUpdates = Math.max(0, this.totalBufferedUpdates - updates.length);
      this.pendingUpdates.delete(roomId);
      this.pendingAcks.delete(roomId);

      // Send acks only AFTER successful DB commit (Invariant I6)
      for (const ack of acks) {
        ack.sendAck(ack.seq);
      }

      // Check compaction
      if (docForCompaction) {
        const totalRows = this.updateRepo.countUpdates(roomId);
        if (totalRows >= COMPACT_AFTER_ROWS) {
          const snapshot = Y.encodeStateAsUpdate(docForCompaction);
          this.roomRepo.updateSnapshot(roomId, snapshot, new Date().toISOString());
          this.updateRepo.compactBefore(roomId, lastId);
        }
      }

      return lastId;
    } catch (err) {
      // Re-schedule flush with backoff/retry, withholding acks
      if (!this.flushTimers.has(roomId)) {
        const retryTimer = setTimeout(() => {
          this.flushTimers.delete(roomId);
          try {
            this.flush(roomId, docForCompaction);
          } catch {
            // Suppress unhandled rejection in timer; will retry on subsequent schedule
          }
        }, this.flushWindowMs);
        this.flushTimers.set(roomId, retryTimer);
      }
      throw err;
    }
  }

  public destroy(): void {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tether/server test src/services/persistenceService.test.ts`
Expected: PASS

---

### Task 3: Check 8 Enforcement in UpgradeGate, Health/Admission Routes, and Room Guard

**Files:**
- Modify: `apps/server/src/ws/upgradeGate.ts`
- Modify: `apps/server/src/http/app.ts`
- Modify: `apps/server/src/rooms/room.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/tests/integration/restAndWs.test.ts`
- Modify: `apps/server/tests/integration/handoverRace.test.ts`
- Modify: `apps/server/tests/integration/serverSyncIntegration.test.ts`
- Modify: `tests/chaos/src/chaosRunner.ts`
- Modify: `tests/chaos/src/bench.ts`
- Modify: `tests/chaos/src/memBench.ts`
- Test: `apps/server/tests/integration/bufferFullAdmission.test.ts`

**Interfaces:**
- Consumes:
  - `PersistenceService.isBufferFull()`
  - `WS_CLOSE_CODES.RESTART` (`1012`)
- Produces:
  - `UpgradeGate`: rejects with HTTP 503 if `isDraining` OR `deps.persistenceService?.isBufferFull()` (Check 8)
  - `GET /health/ready`: returns 503 `{ status: 'buffer_full' }` if `deps.persistenceService?.isBufferFull()`
  - `GET /api/rooms/:id/admission`: returns 200 `{ status: 'draining' }` if `isDraining` OR `deps.persistenceService?.isBufferFull()`
  - `Room.prototype.handleInboundUpdate` & `Room.prototype.handleInboundSyncStep2`: terminates socket with code 1012 and records `'security.buffer_full'` audit event if `persistenceService.isBufferFull()`

- [x] **Step 1: Write integration tests for buffer full admission and health behavior**

Create `apps/server/tests/integration/bufferFullAdmission.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { FastifyInstance } from 'fastify';
import { createDatabase, DatabaseSession } from '../../src/db/database.js';
import { RoomRepo } from '../../src/repo/roomRepo.js';
import { UpdateRepo } from '../../src/repo/updateRepo.js';
import { MemberRepo } from '../../src/repo/memberRepo.js';
import { AuditRepo } from '../../src/repo/auditRepo.js';
import { JoinService } from '../../src/services/joinService.js';
import { RoomService } from '../../src/services/roomService.js';
import { AuditService } from '../../src/services/auditService.js';
import { ChatService } from '../../src/services/chatService.js';
import { ChatRepo } from '../../src/repo/chatRepo.js';
import { PersistenceService } from '../../src/services/persistenceService.js';
import { RoomRegistry } from '../../src/rooms/roomRegistry.js';
import { buildApp } from '../../src/http/app.js';
import { createUpgradeGate } from '../../src/ws/upgradeGate.js';
import { ServerConfig } from '../../src/config.js';
import { PROTOCOL_VERSION, WS_CLOSE_CODES } from '@tether/shared/constants';

describe('Admission Check 8 & Buffer Full Protection', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let memberRepo: MemberRepo;
  let auditRepo: AuditRepo;
  let joinService: JoinService;
  let auditService: AuditService;
  let roomService: RoomService;
  let persistenceService: PersistenceService;
  let roomRegistry: RoomRegistry;
  let app: FastifyInstance;
  let wss: WebSocketServer;
  let serverPort: number;

  const mockConfig: ServerConfig = {
    PORT: 0,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    JWT_SECRET: 'super_secret_jwt_key_that_is_at_least_32_characters_long',
    ALLOWED_ORIGINS: ['http://localhost:3000'],
    DATABASE_DRIVER: 'sqlite',
    SQLITE_PATH: ':memory:',
    HOST_GRACE_MS: 5000,
    PERSIST_FLUSH_MS: 100,
    ROOM_UNLOAD_IDLE_MS: 30000,
    DEMO_MODE: false,
  };

  beforeEach(async () => {
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    memberRepo = new MemberRepo(db);
    auditRepo = new AuditRepo(db);

    joinService = new JoinService(mockConfig.JWT_SECRET);
    auditService = new AuditService(auditRepo);
    const chatService = new ChatService(new ChatRepo(db));
    roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    // Limit to 2 max buffered updates for test
    persistenceService = new PersistenceService(updateRepo, roomRepo, 1000, 2);
    roomRegistry = new RoomRegistry(roomRepo, updateRepo, persistenceService, auditService, 30000);

    const deps = {
      config: mockConfig,
      roomService,
      joinService,
      auditService,
      roomRegistry,
      roomRepo,
      memberRepo,
      auditRepo,
      chatService,
      persistenceService,
    };

    app = buildApp(deps);
    wss = new WebSocketServer({ noServer: true });
    const upgradeHandler = createUpgradeGate(wss, deps);

    app.server.on('upgrade', (req, socket, head) => {
      upgradeHandler(req, socket, head);
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    serverPort = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    roomRegistry.destroy();
    persistenceService.destroy();
    wss.close();
    await app.close();
    db.close();
  });

  it('returns 503 buffer_full on /health/ready when persistence buffer is full', async () => {
    const readyBefore = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(readyBefore.statusCode).toBe(200);

    // Artificially saturate buffer
    (persistenceService as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = 2;
    expect(persistenceService.isBufferFull()).toBe(true);

    const readyAfter = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(readyAfter.statusCode).toBe(503);
    expect(readyAfter.json()).toEqual({ status: 'buffer_full' });
  });

  it('returns draining status on /api/rooms/:id/admission when buffer is full', async () => {
    const createRes = await roomService.createRoom({ roomId: 'test-room', creatorName: 'Host' });
    if ('error' in createRes) throw new Error('Create failed');
    const token = await joinService.issueRoomToken({
      roomId: 'test-room',
      memberId: 'm1',
      displayName: 'Host',
      roomEpoch: 1,
      passcodeVersion: 0,
    });

    // Artificially saturate buffer
    (persistenceService as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = 2;

    const admRes = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/admission',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(admRes.statusCode).toBe(200);
    expect(admRes.json()).toEqual({ status: 'draining' });
  });

  it('rejects WebSocket upgrade with 503 when buffer is full (Check 8)', async () => {
    await roomService.createRoom({ roomId: 'gate-room', creatorName: 'Host' });
    const token = await joinService.issueRoomToken({
      roomId: 'gate-room',
      memberId: 'm1',
      displayName: 'Host',
      roomEpoch: 1,
      passcodeVersion: 0,
    });

    // Saturate buffer
    (persistenceService as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = 2;

    const wsPromise = new Promise<{ code?: number; error?: string }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/gate-room`, [
        PROTOCOL_VERSION,
        token,
      ], {
        headers: { Origin: 'http://localhost:3000' },
      });
      ws.on('unexpected-response', (_req, res) => {
        resolve({ code: res.statusCode });
      });
      ws.on('error', (err) => {
        resolve({ error: err.message });
      });
    });

    const result = await wsPromise;
    expect(result.code).toBe(503);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tether/server test tests/integration/bufferFullAdmission.test.ts`
Expected: FAIL

- [x] **Step 3: Update `UpgradeGateDependencies`, `AppDependencies`, `upgradeGate.ts`, `app.ts`, and `room.ts`**

In `apps/server/src/ws/upgradeGate.ts`:
```typescript
import { PersistenceService } from '../services/persistenceService.js';

export interface UpgradeGateDependencies {
  config: ServerConfig;
  roomRepo: RoomRepo;
  memberRepo: MemberRepo;
  joinService: JoinService;
  roomRegistry: RoomRegistry;
  auditRepo: AuditRepo;
  auditService: AuditService;
  chatService: ChatService;
  persistenceService?: PersistenceService;
}
```
And in `handleUpgrade`:
```typescript
    if (isDraining) {
      return reject(503, 'Service Unavailable: Server Draining');
    }
    if (deps.persistenceService?.isBufferFull()) {
      return reject(503, 'Service Unavailable: Persistence Buffer Full');
    }
```

In `apps/server/src/http/app.ts`:
```typescript
import { PersistenceService } from '../services/persistenceService.js';

export interface AppDependencies {
  config: ServerConfig;
  roomService: RoomService;
  joinService: JoinService;
  auditService: AuditService;
  chatService: ChatService;
  roomRegistry: RoomRegistry;
  roomRepo: RoomRepo;
  memberRepo: MemberRepo;
  persistenceService?: PersistenceService;
}
```
Update `GET /health/ready`:
```typescript
  app.get('/health/ready', async (_req, reply) => {
    if (getIsDraining()) {
      return reply.status(503).send({ status: 'draining' });
    }
    if (deps.persistenceService?.isBufferFull()) {
      return reply.status(503).send({ status: 'buffer_full' });
    }
    return reply.send({ status: 'ready', activeRooms: deps.roomRegistry.activeRoomCount });
  });
```
Update `GET /api/rooms/:id/admission`:
```typescript
    if (getIsDraining() || deps.persistenceService?.isBufferFull()) {
      return reply.send({ status: 'draining' });
    }
```

In `apps/server/src/rooms/room.ts`:
In `handleInboundSyncStep2`:
```typescript
    if (this.persistenceService.isBufferFull()) {
      this.auditService.logEvent(this.id, {
        type: 'security.buffer_full',
        actorMemberId: ctx?.memberId ?? null,
        actorName: ctx?.displayName ?? null,
        payload: { reason: 'persistence_buffer_full' },
      });
      ws.close(WS_CLOSE_CODES.RESTART);
      return;
    }
```
In `handleInboundUpdate`:
```typescript
    if (docUpdate.byteLength > 0) {
      if (this.persistenceService.isBufferFull()) {
        this.auditService.logEvent(this.id, {
          type: 'security.buffer_full',
          actorMemberId: ctx.memberId,
          actorName: ctx.displayName,
          payload: { reason: 'persistence_buffer_full' },
        });
        ws.close(WS_CLOSE_CODES.RESTART);
        return;
      }
      Y.applyUpdate(this.doc, docUpdate, { memberId: ctx.memberId, name: ctx.displayName });
...
```

Update `apps/server/src/index.ts`, `apps/server/tests/integration/restAndWs.test.ts`, `apps/server/tests/integration/handoverRace.test.ts`, `apps/server/tests/integration/serverSyncIntegration.test.ts`, `tests/chaos/src/chaosRunner.ts`, `tests/chaos/src/bench.ts`, and `tests/chaos/src/memBench.ts` to pass `persistenceService` into `deps`.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tether/server test tests/integration/bufferFullAdmission.test.ts`
Expected: PASS

---

### Task 4: Fastify Rate Limiting PreHandler Hook

**Files:**
- Create: `apps/server/src/http/rateLimiter.ts`
- Test: `apps/server/src/http/rateLimiter.test.ts`

**Interfaces:**
- Consumes:
  - `TokenBucket` from `@tether/shared/tokenBucket`
  - `FastifyRequest`, `FastifyReply`, `preHandlerHookHandler` from `fastify`
- Produces:
  - `export interface RateLimitOptions`:
    - `ratePerSec: number`
    - `burst: number`
    - `keyExtractor?: (req: FastifyRequest) => string | null`
    - `clock?: () => number`
    - `idleTimeoutMs?: number`
  - `export function createRateLimitHook(options: RateLimitOptions): preHandlerHookHandler`
  - `export function clearAllRateLimiters(): void` (for tests)

- [x] **Step 1: Write failing unit tests for rate limiter hook**

Create `apps/server/src/http/rateLimiter.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tether/server test src/http/rateLimiter.test.ts`
Expected: FAIL with module `./rateLimiter.js` not found.

- [x] **Step 3: Implement `apps/server/src/http/rateLimiter.ts`**

Create `apps/server/src/http/rateLimiter.ts`:
```typescript
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
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tether/server test src/http/rateLimiter.test.ts`
Expected: PASS

---

### Task 5: Integrate Rate Limiting into HTTP REST Endpoints

**Files:**
- Modify: `apps/server/src/http/app.ts`
- Test: `apps/server/tests/integration/rateLimitIntegration.test.ts`

**Interfaces:**
- Consumes:
  - `createRateLimitHook` from `./rateLimiter.js`
- Produces:
  - Configured rate limiters on endpoints:
    - `POST /api/rooms` -> 10/min/IP (`ratePerSec: 10 / 60`, `burst: 10`)
    - `GET /api/rooms/:id` -> 60/min/IP (`ratePerSec: 1`, `burst: 60`)
    - `POST /api/rooms/:id/join` -> 5/min/(IP + roomId) (`ratePerSec: 5 / 60`, `burst: 5`)
    - `GET /api/rooms/:id/admission` -> 30/min/IP (`ratePerSec: 0.5`, `burst: 30`)
    - `GET /api/rooms/:id/events` -> 60/min/Token (`ratePerSec: 1`, `burst: 60`)
    - `GET /api/rooms/:id/chat` -> 60/min/Token (`ratePerSec: 1`, `burst: 60`)

- [x] **Step 1: Write integration tests for rate limited endpoints**

Create `apps/server/tests/integration/rateLimitIntegration.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createDatabase, DatabaseSession } from '../../src/db/database.js';
import { RoomRepo } from '../../src/repo/roomRepo.js';
import { UpdateRepo } from '../../src/repo/updateRepo.js';
import { MemberRepo } from '../../src/repo/memberRepo.js';
import { AuditRepo } from '../../src/repo/auditRepo.js';
import { JoinService } from '../../src/services/joinService.js';
import { RoomService } from '../../src/services/roomService.js';
import { AuditService } from '../../src/services/auditService.js';
import { ChatService } from '../../src/services/chatService.js';
import { ChatRepo } from '../../src/repo/chatRepo.js';
import { PersistenceService } from '../../src/services/persistenceService.js';
import { RoomRegistry } from '../../src/rooms/roomRegistry.js';
import { buildApp } from '../../src/http/app.js';
import { clearAllRateLimiters } from '../../src/http/rateLimiter.js';
import { ServerConfig } from '../../src/config.js';

describe('HTTP REST Rate Limiting Integration', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let memberRepo: MemberRepo;
  let auditRepo: AuditRepo;
  let joinService: JoinService;
  let auditService: AuditService;
  let roomService: RoomService;
  let persistenceService: PersistenceService;
  let roomRegistry: RoomRegistry;
  let app: FastifyInstance;

  const mockConfig: ServerConfig = {
    PORT: 0,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    JWT_SECRET: 'super_secret_jwt_key_that_is_at_least_32_characters_long',
    ALLOWED_ORIGINS: ['http://localhost:3000'],
    DATABASE_DRIVER: 'sqlite',
    SQLITE_PATH: ':memory:',
    HOST_GRACE_MS: 5000,
    PERSIST_FLUSH_MS: 100,
    ROOM_UNLOAD_IDLE_MS: 30000,
    DEMO_MODE: false,
  };

  beforeEach(async () => {
    clearAllRateLimiters();
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    memberRepo = new MemberRepo(db);
    auditRepo = new AuditRepo(db);

    joinService = new JoinService(mockConfig.JWT_SECRET);
    auditService = new AuditService(auditRepo);
    const chatService = new ChatService(new ChatRepo(db));
    roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    persistenceService = new PersistenceService(updateRepo, roomRepo, 100);
    roomRegistry = new RoomRegistry(roomRepo, updateRepo, persistenceService, auditService, 30000);

    const deps = {
      config: mockConfig,
      roomService,
      joinService,
      auditService,
      roomRegistry,
      roomRepo,
      memberRepo,
      auditRepo,
      chatService,
      persistenceService,
    };

    app = buildApp(deps);
  });

  afterEach(async () => {
    roomRegistry.destroy();
    persistenceService.destroy();
    await app.close();
    db.close();
  });

  it('rate limits POST /api/rooms at 10 requests per IP burst', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'Alice' },
      });
      expect(res.statusCode).toBe(201);
    }

    // 11th request should be rate-limited
    const rateLimited = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Alice' },
    });
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.json().error.code).toBe('rate_limited');
    expect(rateLimited.headers['retry-after']).toBeDefined();
  });

  it('rate limits POST /api/rooms/:id/join at 5 requests per (IP + roomId)', async () => {
    await roomService.createRoom({ roomId: 'target-room', creatorName: 'Host' });

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms/target-room/join',
        payload: { name: `Guest${i}` },
      });
      expect(res.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/rooms/target-room/join',
      payload: { name: 'GuestBlocked' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tether/server test tests/integration/rateLimitIntegration.test.ts`
Expected: FAIL because rate limiting is not yet applied to the routes.

- [x] **Step 3: Apply rate limiting hooks in `apps/server/src/http/app.ts`**

In `apps/server/src/http/app.ts`, import `createRateLimitHook` and `defaultIpKeyExtractor`, and configure rate limiters:
```typescript
import { createRateLimitHook, defaultIpKeyExtractor } from './rateLimiter.js';

// Inside buildApp:
  const roomCreateLimiter = createRateLimitHook({
    ratePerSec: 10 / 60,
    burst: 10,
  });

  const roomGetLimiter = createRateLimitHook({
    ratePerSec: 1,
    burst: 60,
  });

  const joinLimiter = createRateLimitHook({
    ratePerSec: 5 / 60,
    burst: 5,
    keyExtractor: (req) => {
      const ip = defaultIpKeyExtractor(req);
      const roomId = (req.params as { id?: string })?.id?.toLowerCase() ?? 'unknown';
      return `${ip}:${roomId}`;
    },
  });

  const admissionLimiter = createRateLimitHook({
    ratePerSec: 0.5,
    burst: 30,
  });

  const tokenLimiter = createRateLimitHook({
    ratePerSec: 1,
    burst: 60,
    keyExtractor: (req) => {
      const auth = req.headers['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        return auth.slice(7);
      }
      return defaultIpKeyExtractor(req);
    },
  });
```
Attach `preHandler` to each route:
- `app.post('/api/rooms', { preHandler: roomCreateLimiter }, ...)`
- `app.get('/api/rooms/:id', { preHandler: roomGetLimiter }, ...)`
- `app.post('/api/rooms/:id/join', { preHandler: joinLimiter }, ...)`
- `app.get('/api/rooms/:id/admission', { preHandler: admissionLimiter }, ...)`
- `app.get('/api/rooms/:id/chat', { preHandler: tokenLimiter }, ...)`
- `app.get('/api/rooms/:id/events', { preHandler: tokenLimiter }, ...)`

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tether/server test tests/integration/rateLimitIntegration.test.ts`
Expected: PASS

---

### Task 6: OpenAPI 3.1.0 Contract Generation & Endpoint

**Files:**
- Create: `apps/server/src/http/openapi.ts`
- Create: `docs/openapi.json`
- Modify: `apps/server/src/http/app.ts` (route `GET /docs/openapi.json`)
- Test: `apps/server/src/http/openapi.test.ts`

**Interfaces:**
- Consumes: None
- Produces:
  - `export const openApiSpec: Record<string, unknown>` adhering to OpenAPI 3.1.0
  - Endpoint `GET /docs/openapi.json` returning JSON with `application/json`
  - File `docs/openapi.json` containing matching formatted JSON

- [x] **Step 1: Write failing unit test for OpenAPI spec & endpoint**

Create `apps/server/src/http/openapi.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openApiSpec } from './openapi.js';
import { buildApp } from './app.js';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { AuditRepo } from '../repo/auditRepo.js';
import { JoinService } from '../services/joinService.js';
import { RoomService } from '../services/roomService.js';
import { AuditService } from '../services/auditService.js';
import { ChatService } from '../services/chatService.js';
import { ChatRepo } from '../repo/chatRepo.js';
import { PersistenceService } from '../services/persistenceService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { ServerConfig } from '../config.js';

describe('OpenAPI 3.1.0 Specification', () => {
  let db: DatabaseSession;
  let app: FastifyInstance;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const roomRepo = new RoomRepo(db);
    const updateRepo = new UpdateRepo(db);
    const memberRepo = new MemberRepo(db);
    const auditRepo = new AuditRepo(db);
    const joinService = new JoinService('test_secret_at_least_32_chars_long!!');
    const auditService = new AuditService(auditRepo);
    const chatService = new ChatService(new ChatRepo(db));
    const roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    const persistenceService = new PersistenceService(updateRepo, roomRepo, 100);
    const roomRegistry = new RoomRegistry(roomRepo, updateRepo, persistenceService, auditService, 30000);

    const config: ServerConfig = {
      PORT: 0,
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      JWT_SECRET: 'test_secret_at_least_32_chars_long!!',
      ALLOWED_ORIGINS: ['http://localhost:3000'],
      DATABASE_DRIVER: 'sqlite',
      SQLITE_PATH: ':memory:',
      HOST_GRACE_MS: 5000,
      PERSIST_FLUSH_MS: 100,
      ROOM_UNLOAD_IDLE_MS: 30000,
      DEMO_MODE: false,
    };

    app = buildApp({
      config,
      roomService,
      joinService,
      auditService,
      roomRegistry,
      roomRepo,
      memberRepo,
      auditRepo,
      chatService,
      persistenceService,
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('has valid OpenAPI 3.1.0 structure with all core endpoints documented', () => {
    expect(openApiSpec.openapi).toBe('3.1.0');
    expect(openApiSpec.info).toBeDefined();
    const paths = openApiSpec.paths as Record<string, unknown>;
    expect(paths['/api/rooms']).toBeDefined();
    expect(paths['/api/rooms/{id}']).toBeDefined();
    expect(paths['/api/rooms/{id}/join']).toBeDefined();
    expect(paths['/api/rooms/{id}/admission']).toBeDefined();
    expect(paths['/api/rooms/{id}/events']).toBeDefined();
    expect(paths['/api/rooms/{id}/chat']).toBeDefined();
    expect(paths['/health/live']).toBeDefined();
    expect(paths['/health/ready']).toBeDefined();
    expect(paths['/metrics']).toBeDefined();
  });

  it('serves openapi spec via GET /docs/openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual(openApiSpec);
  });

  it('matches static docs/openapi.json on disk', () => {
    const diskPath = resolve(process.cwd(), 'docs/openapi.json');
    const diskContent = JSON.parse(readFileSync(diskPath, 'utf-8'));
    expect(diskContent).toEqual(openApiSpec);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tether/server test src/http/openapi.test.ts`
Expected: FAIL with module `./openapi.js` not found.

- [x] **Step 3: Create `apps/server/src/http/openapi.ts` and `docs/openapi.json` and register route in `app.ts`**

Create `apps/server/src/http/openapi.ts` defining OpenAPI 3.1.0 specification covering:
- `/api/rooms` (POST)
- `/api/rooms/{id}` (GET)
- `/api/rooms/{id}/join` (POST)
- `/api/rooms/{id}/admission` (GET)
- `/api/rooms/{id}/events` (GET)
- `/api/rooms/{id}/chat` (GET)
- `/health/live` (GET)
- `/health/ready` (GET)
- `/metrics` (GET)

Write identical formatted content to `docs/openapi.json`.
In `apps/server/src/http/app.ts`, add route:
```typescript
  app.get('/docs/openapi.json', async (_req, reply) => {
    return reply.header('Content-Type', 'application/json').send(openApiSpec);
  });
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tether/server test src/http/openapi.test.ts`
Expected: PASS

---

### Task 7: Full Monorepo Verification & Chaos Test Suite Run

**Files:**
- None (verification across all packages and apps)

**Interfaces:**
- Consumes: All packages and applications

- [x] **Step 1: Re-build shared package**

Run: `pnpm --filter @tether/shared build:pkg`
Expected: Exits with code 0

- [x] **Step 2: Run all unit & integration tests**

Run: `pnpm test`
Expected: All test files pass across `@tether/shared`, `@tether/sync-client`, `@tether/server`, `@tether/web`, and `@tether/chaos`.

- [x] **Step 3: Run full TypeScript typecheck**

Run: `pnpm typecheck`
Expected: 0 errors across all workspaces.

- [x] **Step 4: Run linter**

Run: `pnpm lint`
Expected: 0 warnings and 0 errors.

- [x] **Step 5: Run chaos CI suite**

Run: `pnpm chaos:ci`
Expected: 100% invariant convergence.
