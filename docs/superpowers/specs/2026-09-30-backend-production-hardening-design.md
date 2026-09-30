# Backend Production Hardening Design Specification

**Date:** 2026-09-30  
**Status:** Approved  
**Topic:** Backend Production Hardening: HTTP REST Rate Limiting, Bounded Persistence Engine & Admission Check 8, OpenAPI 3.1.0 Contract, and Vitest Stabilization.

---

## 1. Context & Motivation

Tether's backend (`apps/server`) provides real-time collaborative document synchronization, role management, audit logging, and text chat over WebSocket and Fastify HTTP REST endpoints.
While the real-time binary synchronization engine, WebSocket protocol guards, and DB repositories are in place, the production requirements in `docs/04-protocol.md`, `docs/05-rooms-security-roles.md`, and `docs/09-operations.md` require:
1. **HTTP REST Rate Limiting:** Protecting all public and authenticated endpoints from brute force and DoS (IP-based and Token-based TokenBucket rate limiting).
2. **Bounded Persistence Buffer & Admission Check 8:** Preventing unbounded memory growth during database stalls or bursts by capping the server-wide update buffer at 10,000 updates, triggering immediate flushes at 64 updates per room, and rejecting connections/reporting 503 when the buffer is full.
3. **OpenAPI 3.1.0 Contract:** Providing a machine-readable schema for all REST endpoints at `docs/openapi.json` and exposing `GET /docs/openapi.json`.
4. **Test Infrastructure Stabilization:** Eliminating intermittent test timeouts caused by parallel monorepo CPU contention.

---

## 2. Architectural Design

```
+-----------------------------------------------------------------------------------------+
|                               Fastify HTTP REST Layer                                   |
|                                                                                         |
|  [RateLimiterHook]                                                                      |
|    - POST /api/rooms            -> 10/min/IP                                            |
|    - GET  /api/rooms/:id        -> 60/min/IP                                            |
|    - POST /api/rooms/:id/join   -> 5/min/(IP + roomId)  [Brute-force protection]        |
|    - GET  /api/rooms/:id/admiss -> 30/min/IP                                            |
|    - GET  /api/rooms/:id/events -> 60/min/Token                                         |
|    - GET  /api/rooms/:id/chat   -> 60/min/Token                                         |
|                                                                                         |
|  [OpenAPI Spec]                                                                         |
|    - GET  /docs/openapi.json    -> OpenAPI 3.1.0 spec                                    |
|                                                                                         |
|  [Health & Admission Checks]                                                            |
|    - GET  /health/ready         -> 503 if draining OR PersistenceService.isBufferFull()  |
|    - GET  /api/rooms/:id/admiss -> 'draining' if draining OR isBufferFull()             |
+--------------------------------------------+--------------------------------------------+
                                             |
                                             v
+--------------------------------------------+--------------------------------------------+
|                       WebSocket Upgrade Gate (Check 8)                                 |
|                                                                                         |
|   1. Origin in ALLOWED_ORIGINS                                                          |
|   2. Subprotocol collab.v1 & Token present                                              |
|   3. Valid JWT signature, exp, aud, epoch, pv                                           |
|   4. Room exists                                                                        |
|   5. Member not banned                                                                  |
|   6. Room not locked (or member previously joined)                                      |
|   7. Caps: IP <= 20, Room <= 32                                                         |
|   8. Server NOT draining AND Persistence buffer NOT full -> reject 503 if violated       |
+--------------------------------------------+--------------------------------------------+
                                             |
                                             v
+--------------------------------------------+--------------------------------------------+
|                          Persistence Service & Engine                                   |
|                                                                                         |
|   - totalBufferedUpdates: global counter across all active rooms                        |
|   - PERSIST_MAX_BUFFERED_UPDATES = 10,000 (server-wide limit)                          |
|   - PERSIST_MAX_QUEUED_PER_ROOM = 64 (triggers immediate flush before 250ms timer)      |
|   - Safe commit-before-delete flush; acks sent strictly after DB commit                 |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Detailed Component Specifications

### 3.1 HTTP REST Rate Limiting (`apps/server/src/http/rateLimiter.ts`)
- Reuses `@tether/shared`'s pure `TokenBucket` class (`packages/shared/src/tokenBucket.ts`).
- Provides a factory function `createRateLimitHook(options)` returning a Fastify `preHandler` hook.
- **Eviction:** Periodically sweeps out inactive buckets idle for $> 5$ minutes to prevent memory leaks from one-off IPs or expired tokens.
- **Extraction Logic:**
  - IP-based: `request.ip || request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown'`
  - Room-Join composite: `${ip}:${roomId.toLowerCase()}`
  - Token-based: Extracts Bearer token from `Authorization: Bearer <token>`
- **Response Format on 429:**
  ```json
  {
    "error": {
      "code": "rate_limited",
      "message": "Too many requests. Please try again later."
    }
  }
  ```
  Sets `Retry-After: <seconds>` header rounded up to the next available token time.

### 3.2 Bounded Persistence Buffer & Admission Check 8
- **New Constants in `@tether/shared/constants.ts`:**
  - `PERSIST_MAX_QUEUED_PER_ROOM = 64`
  - `PERSIST_MAX_BUFFERED_UPDATES = 10_000`
- **`PersistenceService` updates (`apps/server/src/services/persistenceService.ts`):**
  - Maintains `totalBufferedUpdates: number`.
  - In `enqueueUpdate(roomId, update, ackRecipient)`:
    - If `totalBufferedUpdates >= PERSIST_MAX_BUFFERED_UPDATES`, rejects / throws `BufferFullError`.
    - Increments `totalBufferedUpdates`.
    - If `list.length >= PERSIST_MAX_QUEUED_PER_ROOM`, cancels scheduled timer and immediately flushes `flush(roomId, resolveDoc?.(roomId))`.
  - In `flush(roomId, doc)`:
    - On successful commit, decrements `totalBufferedUpdates` by `updates.length`.
  - Exposes `isBufferFull(): boolean` returning `totalBufferedUpdates >= PERSIST_MAX_BUFFERED_UPDATES`.
- **`UpgradeGate` (`apps/server/src/ws/upgradeGate.ts`):**
  - Enforces Check 8: `if (deps.persistenceService.isBufferFull()) return reject(503, 'Service Unavailable: Persistence Buffer Full');`.
- **`App` Routes (`apps/server/src/http/app.ts`):**
  - `GET /health/ready`: If `getIsDraining()`, returns 503 `{ status: 'draining' }`. If `deps.persistenceService.isBufferFull()`, returns 503 `{ status: 'buffer_full' }`.
  - `GET /api/rooms/:id/admission`: Returns `{ status: 'draining' }` if `getIsDraining()` or `deps.persistenceService.isBufferFull()`.
- **`Room.handleInboundUpdate` (`apps/server/src/rooms/room.ts`):**
  - Checks `if (this.persistenceService.isBufferFull())`, logs audit event `security.buffer_full` and terminates socket with code `1012` to protect the process.

### 3.3 OpenAPI 3.1.0 Contract (`docs/openapi.json` & `apps/server/src/http/openapi.ts`)
- Defines full OpenAPI specification in pure TypeScript conforming to OpenAPI 3.1.0.
- Covers endpoints:
  - `POST /api/rooms`
  - `GET /api/rooms/{id}`
  - `POST /api/rooms/{id}/join`
  - `GET /api/rooms/{id}/admission`
  - `GET /api/rooms/{id}/events`
  - `GET /api/rooms/{id}/chat`
  - `GET /health/live`, `GET /health/ready`, `GET /metrics`
- Mounts `GET /docs/openapi.json` on the Fastify instance.
- Adds script `pnpm --filter @tether/server generate:openapi` or an automated unit test that ensures `docs/openapi.json` matches the server route contracts.

### 3.4 Vitest Test Configuration (`vitest.config.ts`)
- Updates `vitest.config.ts` to include `testTimeout: 15000` to ensure heavy concurrent test runs across all 5 workspace projects pass reliably without artificial clock timeouts.

---

## 4. Verification & Testing Strategy

1. **Unit Tests:**
   - `apps/server/src/http/rateLimiter.test.ts`: Test burst, steady-state consumption, eviction of stale buckets, and composite keying using fake/injected clock.
   - `apps/server/src/services/persistenceService.test.ts`: Verify instant flush at 64 updates, bounded cap at 10,000 updates, and buffer counter accuracy across retries.
2. **Integration Tests:**
   - `apps/server/tests/integration/rateLimitIntegration.test.ts`: Send requests exceeding rate limits to `/api/rooms`, `/api/rooms/:id/join`, `/api/rooms/:id/events` and assert 429 status code and `Retry-After` header.
   - `apps/server/tests/integration/restAndWs.test.ts`: Test admission check 8 rejection when buffer is full and health endpoint returns 503.
3. **Monorepo Verification:**
   - `pnpm test` (all 50+ test files green)
   - `pnpm typecheck` (0 errors)
   - `pnpm lint` (0 errors)
   - `pnpm chaos:ci` (100% invariant convergence)
