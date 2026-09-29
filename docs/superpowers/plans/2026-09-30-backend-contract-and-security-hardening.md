# Backend Contract, Protocol & Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix REST API response schema mismatches, implement real-time WebSocket audit event push and awareness cleanup, enforce binary protocol invariants (handshake sequencing, slow-consumer drops, doc size limits), and harden persistence error handling.

**Architecture:**
1. **HTTP REST Contract & Admission:** Update `GET /api/rooms/:id/events` to map database snake_case columns to camelCase `AuditEvent` and provide `nextBefore`/`nextAfter` cursors. Enhance `GET /api/rooms/:id/admission` to validate passcode version, epoch, and server capacity.
2. **WebSocket Event & Presence Pipeline:** Connect `AuditService` event emission directly to live WebSocket broadcast (`{ t: 'event' }`). Add active socket termination (`4003`) on `host.kick`. Broadcast `null` awareness states on connection drop to prevent ghost cursors. Fill real sliding tokens and current `eventSeq` in `welcome`.
3. **Wire Protocol Guards:** Track connection lifecycle state (first frame `SYNC_STEP1`, strictly increasing `seq`, `UPDATE` post-handshake, 4 MB slow consumer limit, 2 MB doc limit).
4. **Persistence & Lifecycle:** Safeguard `PersistenceService.flush` by deleting updates from memory only after successful database commit; implement server draining flag and send `1012` on shutdown.

**Tech Stack:** TypeScript (strict), Fastify 5, `ws`, Yjs, lib0, Node.js 22, SQLite (`better-sqlite3` / `node:sqlite`), Vitest.

**Spec References:**
- `docs/03-sync-engine.md` (Sections 3.4, 4.3, 4.6, 5, 7)
- `docs/04-protocol.md` (Wire protocol, close codes, control messages, limits)
- `docs/05-rooms-security-roles.md` (Admission checklist, kick/ban, roles)
- `docs/06-data-model.md` (Audit event schemas and access patterns)
- `docs/10-roadmap.md` (M2, M7, M8)

---

## Global Constraints
- TypeScript strict mode enabled everywhere; no `any`.
- Never commit to git (the human operator commits).
- Never run database migrations.
- Keep all files $\le 700$ lines.
- Vitest unit & integration tests must pass 100% green before completion.

---

## User Review Required

> [!IMPORTANT]
> **REST Response Casing**: `GET /api/rooms/:id/events` will now return items formatted in `camelCase` (`roomId`, `actorMemberId`, `actorName`, `createdAt`) instead of SQLite's native `snake_case`. This aligns the server with `@tether/shared` schemas and the web client types.

> [!NOTE]
> **Host Kick Action**: When a host kicks a user, in addition to marking them banned in the database and emitting `member.left`, the server will now actively close any open WebSocket connections belonging to that `memberId` with code `4003` (`KICKED`).

---

## Proposed Changes

```
apps/server/
  src/
    http/
      app.ts                   # Fix events pagination, mapping, admission checks
    ws/
      connectionHandler.ts     # Protocol sequence rules, kick socket close, sliding token
      upgradeGate.ts           # Draining check
    rooms/
      room.ts                  # Event broadcast hook, awareness nulling on drop, slow consumer check
    services/
      auditService.ts          # Event notification callback hook
      persistenceService.ts    # Safe commit-before-delete flush
    index.ts                   # Draining flag & 1012 socket close on SIGINT/SIGTERM
```

---

### Task 1: HTTP REST Contract Fixes (`events` Casing/Cursors & `admission` Verification)

**Files:**
- Modify: `apps/server/src/http/app.ts`
- Modify: `apps/server/src/repo/auditRepo.ts`
- Test: `apps/server/tests/integration/restAndWs.test.ts`

**Interfaces:**
- Consumes:
  - `AuditEventSchema` from `@tether/shared/protocol/schemas`
- Produces:
  - `GET /api/rooms/:id/events`: `{ items: AuditEvent[], nextBefore: number | null, nextAfter: number | null }`
  - `GET /api/rooms/:id/admission`: validates `pv`, `ep`, room capacity, and returns `{ status: AdmissionStatus }`

- [ ] **Step 1: Write integration tests for `events` pagination and `admission` checks**
  Add tests in `apps/server/tests/integration/restAndWs.test.ts`:
  1. `GET /api/rooms/:id/events` validates returned item properties are camelCase (`roomId`, `createdAt`, etc.) and matches `AuditEventSchema`.
  2. `GET /api/rooms/:id/events` checks `nextBefore` and `nextAfter` cursor values.
  3. `GET /api/rooms/:id/admission` returns `reauth` if passcode version in token is stale (`claims.pv !== room.passcode_version`).
  4. `GET /api/rooms/:id/admission` returns `reauth` if room epoch is stale (`claims.ep !== room.epoch`).

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/server test`
  Expected: FAIL on cursor/casing and admission checks.

- [ ] **Step 3: Implement fixes in `app.ts` and `auditRepo.ts`**
  - In `auditRepo.ts`: map database rows to camelCase interface:
    ```typescript
    export interface FormattedAuditEvent {
      id: number;
      roomId: string;
      seq: number;
      type: string;
      actorMemberId: string | null;
      actorName: string | null;
      payload: Record<string, unknown>;
      createdAt: string;
    }
    ```
  - In `app.ts` (`/api/rooms/:id/events`):
    - When `after` is queried: `nextAfter = items.length === limit ? items[items.length - 1].seq : null`.
    - When `before` is queried: `nextBefore = items.length === limit ? items[items.length - 1].seq : null`.
  - In `app.ts` (`/api/rooms/:id/admission`):
    - Verify `claims.ep === room.epoch`, return `{ status: 'reauth' }` if mismatched.
    - Verify `room.passcode_hash === null || claims.pv === room.passcode_version`, return `{ status: 'reauth' }` if mismatched.
    - Check if room member count >= `MAX_MEMBERS_PER_ROOM` and member not already admitted, return `{ status: 'full' }`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test`
  Expected: PASS

---

### Task 2: Real-Time Audit Event WebSocket Broadcast & Comprehensive Event Logging

**Files:**
- Modify: `apps/server/src/services/auditService.ts`
- Modify: `apps/server/src/rooms/room.ts`
- Modify: `apps/server/src/rooms/roomRegistry.ts`
- Modify: `apps/server/src/ws/connectionHandler.ts`
- Test: `apps/server/tests/integration/restAndWs.test.ts`

**Interfaces:**
- Consumes:
  - `ServerEventSchema` from `@tether/shared/protocol/schemas`
- Produces:
  - Live broadcast `{ t: 'event', event: AuditEvent }` to all clients in the room upon event commit
  - Audit logging for room settings (`room.locked`, `room.unlocked`, `room.passcode`, `room.language`) and member leave/kick

- [x] **Step 1: Write integration tests for live event WebSocket push**
  Add tests in `restAndWs.test.ts` verifying that when a host command (lock, passcode, language) or action occurs:
  1. An audit event is logged in the DB.
  2. All connected clients receive a `{ t: 'event', event: { ... } }` message.

- [x] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/server test`
  Expected: FAIL (WebSocket does not receive `t: 'event'`).

- [x] **Step 3: Implement event broadcast hook in `AuditService` and `Room`**
  - Add `onEventLogged?: (roomId: string, event: AuditEvent) => void` callback to `AuditService`.
  - In `RoomRegistry`: wire `auditService.onEventLogged` to locate the active `Room` and call `room.broadcastControl({ t: 'event', event })`.
  - In `connectionHandler.ts`:
    - On `host.lock`: log event `room.locked` or `room.unlocked`.
    - On `host.passcode`: log event `room.passcode` with `{ action: 'set' | 'changed' | 'cleared' }`.
    - On `host.language`: log event `room.language` with `{ from, to }`.
    - On `host.kick`: log event `member.left` with `{ reason: 'kicked' }`.
    - On `welcome`: populate `token` with freshly issued JWT via `joinService.issueRoomToken`, and `eventSeq` with `deps.auditRepo.getLatestSeq(room.id)`.

- [x] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test`
  Expected: PASS

---

### Task 3: Member Disconnect Awareness Cleanup & Kick Socket Termination

**Files:**
- Modify: `apps/server/src/rooms/room.ts`
- Modify: `apps/server/src/ws/connectionHandler.ts`
- Test: `apps/server/src/rooms/rooms.test.ts`

**Interfaces:**
- Consumes:
  - `WS_CLOSE_CODES.KICKED` (4003)
  - `awarenessProtocol.removeAwarenessStates`
- Produces:
  - Immediate `awarenessProtocol` broadcast with state `null` on socket disconnect
  - Hard termination of all sockets for kicked `memberId` with code `4003`

- [x] **Step 1: Write unit tests in `rooms.test.ts`**
  1. Verify kicking a member closes their active WebSocket with code `4003`.
  2. Verify disconnecting a connection broadcasts awareness update with that client's state cleared.

- [x] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/server test`
  Expected: FAIL

- [x] **Step 3: Implement kick termination & awareness removal**
  - In `Room`:
    - Add `terminateMemberSockets(memberId: string, closeCode = WS_CLOSE_CODES.KICKED)` method.
    - In `removeConnection`: retrieve claimed `clientID` from `ctx.awarenessBinding`, call `awarenessProtocol.removeAwarenessStates(this.awareness, [claimedClientID], this)`, and broadcast awareness frame immediately.
  - In `connectionHandler.ts`:
    - In `case 'host.kick'`: call `room.terminateMemberSockets(msg.memberId, WS_CLOSE_CODES.KICKED)`.

- [x] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test`
  Expected: PASS

---

### Task 4: Protocol Invariant Guards (Handshake Ordering, Slow Consumer & Doc Cap)

**Files:**
- Create: `apps/server/src/sync/protocolGuard.ts`
- Modify: `apps/server/src/ws/connectionHandler.ts`
- Modify: `apps/server/src/rooms/room.ts`
- Test: `apps/server/src/sync/protocolGuard.test.ts`

**Interfaces:**
- Consumes:
  - `MAX_DOC_BYTES` (2 MB), `SLOW_CONSUMER_BYTES` (4 MB), `WS_CLOSE_CODES.PROTOCOL_VIOLATION` (4009), `WS_CLOSE_CODES.SLOW_CONSUMER` (4008), `WS_CLOSE_CODES.DOC_TOO_LARGE` (4013)
- Produces:
  - `ProtocolGuard` tracking per-connection state (`hasStep1`, `hasStep2`, `handshakeComplete`, `lastSeq`)

- [ ] **Step 1: Write unit tests for `ProtocolGuard`**
  Test rules:
  1. Non-`SYNC_STEP1` first frame -> returns `4009`.
  2. Duplicate `SYNC_STEP1` -> returns `4009`.
  3. `UPDATE` before handshake complete -> returns `4009`.
  4. Non-increasing sequence number (`seq <= lastSeq`) -> returns `4009`.
  5. Valid sequence (`SYNC_STEP1` -> server reply -> `SYNC_STEP2` -> `UPDATE(seq=1)` -> `UPDATE(seq=2)`) -> allowed.

- [ ] **Step 2: Implement `ProtocolGuard` in `apps/server/src/sync/protocolGuard.ts`**
  Implement state machine validating frames against spec rules.

- [ ] **Step 3: Wire into `connectionHandler.ts` and `room.ts`**
  - Attach `ProtocolGuard` to each connection in `connectionHandler.ts`.
  - In `room.ts` broadcast loop: check if `conn.bufferedAmount > SLOW_CONSUMER_BYTES`. If so, close with `WS_CLOSE_CODES.SLOW_CONSUMER` (4008).
  - In `room.ts` `handleInboundUpdate`: verify total doc size `Y.encodeStateAsUpdate(this.doc).byteLength <= MAX_DOC_BYTES`. If exceeded, reject and close with `WS_CLOSE_CODES.DOC_TOO_LARGE` (4013).

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test`
  Expected: PASS

---

### Task 5: Persistence Resilience & Graceful Shutdown (1012)

**Files:**
- Modify: `apps/server/src/services/persistenceService.ts`
- Modify: `apps/server/src/rooms/room.ts`
- Modify: `apps/server/src/rooms/roomRegistry.ts`
- Modify: `apps/server/src/ws/upgradeGate.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/src/services/services.test.ts`

**Interfaces:**
- Consumes:
  - `WS_CLOSE_CODES.SERVER_RESTART` (1012)
- Produces:
  - Crash-safe flush: retain updates/acks in memory until `insertBatch` successfully returns
  - Clean shutdown: set draining flag (upgrade gate returns 503) and terminate all active WebSockets with 1012

- [ ] **Step 1: Write unit tests for safe flush on failure**
  In `services.test.ts`: mock `updateRepo.insertBatch` to throw an error once, verify `persistenceService.flush` retains updates and retries on next call without losing data.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/server test`
  Expected: FAIL

- [ ] **Step 3: Implement safe flush and graceful drain**
  - In `PersistenceService.flush`:
    ```typescript
    try {
      const lastId = this.updateRepo.insertBatch(roomId, merged);
      // Delete ONLY after successful DB commit
      this.pendingUpdates.delete(roomId);
      this.pendingAcks.delete(roomId);
      for (const ack of acks) ack.sendAck(ack.seq);
      return lastId;
    } catch (err) {
      // Re-schedule flush with backoff, withholding acks
      this.scheduleFlush(roomId);
      throw err;
    }
    ```
  - In `UpgradeGate`: export `setDraining(isDraining: boolean)`. If draining, reject upgrade with `HTTP 503 Service Unavailable: Server Draining`.
  - In `Room.destroy(closeCode = WS_CLOSE_CODES.SERVER_RESTART)`: close all active WebSockets with code `1012`.
  - In `index.ts`: in shutdown hook, set draining to `true`, flush all rooms, and close sockets with `1012`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test`
  Expected: PASS

---

### Task 6: Full Verification Suite

- [ ] **Step 1: Run all unit and integration tests**
  Run: `pnpm test`
  Expected: PASS across all packages.

- [ ] **Step 2: Run chaos CI test**
  Run: `pnpm run chaos:ci`
  Expected: PASS

- [ ] **Step 3: Run typecheck**
  Run: `pnpm typecheck`
  Expected: Clean compilation with 0 errors.

- [ ] **Step 4: Run linter**
  Run: `pnpm lint`
  Expected: Clean lint pass.

---

## Verification Plan

### Automated Tests
- Unit tests:
  - `pnpm --filter @tether/server test`
- Workspace tests:
  - `pnpm test`
- Chaos convergence test:
  - `pnpm run chaos:ci`
- Typechecking:
  - `pnpm typecheck`
- Linting:
  - `pnpm lint`

### Manual Verification
1. Start server: `pnpm --filter @tether/server dev`
2. Test REST endpoint casing:
   - `POST /api/rooms` -> returns room and token
   - `GET /api/rooms/:id/events` -> verify JSON contains camelCase `roomId` and `nextBefore` / `nextAfter`.
3. Test Admission Probe:
   - `GET /api/rooms/:id/admission` with valid token -> `{ status: "ok" }`.
   - Update room passcode via host command, probe again with old token -> `{ status: "reauth" }`.
4. Test WebSocket Kick:
   - Connect two test clients, issue `host.kick` from host -> verify target client socket closes with code `4003`.
