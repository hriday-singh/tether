# Server-Side Bot Storm Spawner (P2 Demo Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the server-side bot storm spawner in `@tether/server` to handle the `demo.storm` host command in demo mode by launching in-process virtual bot clients (`@tether/sync-client` + `FaultyTransport`) that join over loopback WebSockets, simulate realistic collaborative editing and network faults, and restore pre-storm document state via `Y.UndoManager` before leaving.

**Architecture:**
- Create `FaultyWebSocket` in `packages/sync-client/src/testing/faultyWebSocket.ts` (moving from `tests/chaos`), wrapping Node `ws` with `FaultyTransport` for network jitter and fault simulation.
- In `@tether/server`, build `BotStormManager` (`apps/server/src/rooms/botStormManager.ts`), which mints bot JWT tokens via `JoinService`, creates bot members, and spawns $N$ (1–8) headless `SyncClient` instances.
- Connect bots to loopback WebSockets (`ws://127.0.0.1:${port}/ws/rooms/${roomId}`), passing through the full HTTP upgrade gate and authentication.
- Track bot identity in `Room` so that roster entries report `isBot: true`.
- Run concurrent bot typing loops (tagged code snippets and cursor positions), and on storm expiration, invoke `Y.UndoManager.undo()` to cleanly restore original text, flush persistence, and leave the room.
- Wire `BotStormManager` into `connectionHandler.ts` under `demo.storm` (with concurrency locks and capacity checks), Fastify server lifecycle, and graceful shutdown.

**Tech Stack:** TypeScript (strict), Node.js 22, Fastify 5, ws, Yjs, `y-protocols`, Vitest.

**Spec References:**
- `docs/04-protocol.md` (Control Messages, `demo.storm`, Member schema)
- `docs/05-rooms-security-roles.md` (Admission checklist, guest tokens)
- `docs/08-testing-and-verification.md` (Section: Bot storm P2, demo mode)
- `docs/10-roadmap.md` (Milestone M9: P2 bot storm)

---

## Global Constraints

- Never commit directly. Make code changes only; commits are reserved for the user.
- Never run database migrations. No database schema changes are required for this plan.
- Keep all files $\le 700$ lines.
- Modular architecture with clean interfaces and dependency injection.
- When modifying `packages/sync-client` or `packages/shared`, compile with `pnpm --filter @tether/shared build:pkg` and `pnpm --filter @tether/sync-client build:pkg`.
- Move `@tether/sync-client` from `devDependencies` to `dependencies` in `apps/server/package.json` so server-side bot spawning works in production builds.
- All Vitest unit and integration tests must pass: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

---

## User Review Required

> [!IMPORTANT]
> **Loopback Network Port Resolution**: In order for in-process bots to connect to `ws://127.0.0.1:${port}/ws/rooms/${roomId}`, the server needs to know its listening port. The Fastify server port is resolved dynamically via `app.server.address()` (which supports port `0` in tests or `config.PORT` in dev/prod) and passed to `BotStormManager`.

> [!NOTE]
> **Zero Text Loss via `Y.UndoManager`**: Each bot tracks its own origin (`botId`) in `Y.UndoManager`. When the storm timer elapses, each bot calls `undoManager.undo()` until exhausted. This automatically removes only the text inserted by that specific bot, preserving any concurrent keystrokes typed by human participants.

---

## Proposed Changes

```
packages/sync-client/
  src/
    testing/
      faultyWebSocket.ts       # [NEW] Exportable FaultyWebSocket adapter wrapping ws with FaultyTransport
      faultyWebSocket.test.ts  # [NEW] Unit tests for FaultyWebSocket
      index.ts                 # [NEW] Barrel export for @tether/sync-client/testing
  package.json                 # Update ./testing export to include faultyWebSocket

apps/server/
  package.json                 # Move @tether/sync-client to dependencies
  src/
    rooms/
      room.ts                  # Add isBot tracking and bot socket termination
      botStormManager.ts       # [NEW] In-process bot coordinator, typing runner, and undo cleaner
      botStormManager.test.ts  # [NEW] Unit tests for BotStormManager
    ws/
      connectionHandler.ts     # Wire demo.storm to botStormManager.startStorm with conflict checks
      upgradeGate.ts           # Add botStormManager to UpgradeGateDependencies
    http/
      app.ts                   # Add botStormManager to AppDependencies
    index.ts                   # Instantiate botStormManager, pass listening port, wire into shutdown
  tests/
    integration/
      botStormIntegration.test.ts # [NEW] End-to-end integration test of demo.storm over loopback WebSocket
```

---

### Task 1: Exportable `FaultyWebSocket` in `@tether/sync-client/testing`

**Files:**
- Create: `packages/sync-client/src/testing/faultyWebSocket.ts`
- Create: `packages/sync-client/src/testing/faultyWebSocket.test.ts`
- Create: `packages/sync-client/src/testing/index.ts`
- Modify: `packages/sync-client/package.json`
- Modify: `tests/chaos/src/faultyWebSocket.ts` (re-export or alias from `@tether/sync-client/testing`)

**Interfaces:**
- Consumes:
  - `FaultyTransport` from `packages/sync-client/src/testing/faultyTransport.ts`
  - `WebSocket` from `ws`
- Produces:
  - `export class FaultyWebSocket`: standard WebSocket-compatible interface wrapping `ws.WebSocket` with inbound & outbound `FaultyTransport`.
  - Re-exported from `@tether/sync-client/testing`.

- [ ] **Step 1: Write failing unit test for `FaultyWebSocket`**
  Create `packages/sync-client/src/testing/faultyWebSocket.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { WebSocketServer } from 'ws';
  import { FaultyWebSocket } from './faultyWebSocket.js';

  describe('FaultyWebSocket', () => {
    let wss: WebSocketServer;
    let port: number;

    beforeEach(async () => {
      wss = new WebSocketServer({ port: 0 });
      await new Promise<void>((resolve) => wss.on('listening', () => resolve()));
      const addr = wss.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
    });

    afterEach(() => {
      wss.close();
    });

    it('connects to real WebSocket server and exchanges messages with simulated latency', async () => {
      wss.on('connection', (ws) => {
        ws.on('message', (msg) => {
          ws.send(`echo:${msg.toString()}`);
        });
      });

      const client = new FaultyWebSocket(`ws://127.0.0.1:${port}`, undefined, {
        transportOptions: { minLatencyMs: 10, maxLatencyMs: 20 },
      });

      const received: string[] = [];
      await new Promise<void>((resolve) => {
        client.onopen = () => {
          client.send('hello');
        };
        client.onmessage = (event) => {
          received.push(event.data.toString());
          client.close();
          resolve();
        };
      });

      expect(received).toEqual(['echo:hello']);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/sync-client test src/testing/faultyWebSocket.test.ts`
  Expected: FAIL (`FaultyWebSocket` not found).

- [ ] **Step 3: Implement `FaultyWebSocket` and barrel export in `packages/sync-client`**
  1. Move/implement `FaultyWebSocket` in `packages/sync-client/src/testing/faultyWebSocket.ts`.
  2. Create `packages/sync-client/src/testing/index.ts` exporting `FaultyTransport` and `FaultyWebSocket`.
  3. In `packages/sync-client/package.json`, update `./testing` export:
     ```json
     "./testing": {
       "types": "./dist/testing/index.d.ts",
       "import": "./dist/testing/index.js",
       "default": "./dist/testing/index.js"
     }
     ```
  4. In `tests/chaos/src/faultyWebSocket.ts`, re-export `FaultyWebSocket` from `@tether/sync-client/testing`.

- [ ] **Step 4: Build package and verify tests pass**
  Run: `pnpm --filter @tether/sync-client build:pkg && pnpm --filter @tether/sync-client test`
  Expected: PASS

---

### Task 2: Bot Identity and Flagging in `Room` & `@tether/server` Dependencies

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/rooms/room.ts`
- Modify: `apps/server/src/ws/connectionHandler.ts`
- Test: `apps/server/src/rooms/rooms.test.ts`

**Interfaces:**
- Consumes:
  - `Member` schema from `@tether/shared/protocol/schemas`
- Produces:
  - `Room.prototype.isBot(memberId: string): boolean`
  - `Room.prototype.markBot(memberId: string): void`
  - `Room.prototype.addConnection(ws, member, isBot?: boolean)`
  - `allMembers` in `welcome` and `member.joined` control messages correctly report `isBot: true` for bot members.

- [ ] **Step 1: Write test in `apps/server/src/rooms/rooms.test.ts` for bot member flag**
  Verify that adding a connection with `isBot: true` preserves `isBot` on `room.isBot(memberId)` and exports `isBot: true` in members.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/server test src/rooms/rooms.test.ts`
  Expected: FAIL (missing `isBot` method on `Room`).

- [ ] **Step 3: Implement `isBot` tracking on `Room` and connection handler**
  1. In `apps/server/package.json`, move `@tether/sync-client: "workspace:*"` from `devDependencies` to `dependencies`.
  2. In `apps/server/src/rooms/room.ts`:
     - Add `private botMemberIds = new Set<string>();`
     - Add `public markBot(memberId: string): void { this.botMemberIds.add(memberId); }`
     - Add `public isBot(memberId: string): boolean { return this.botMemberIds.has(memberId); }`
     - In `addConnection(ws, member, isBot?: boolean)`: if `isBot`, `this.botMemberIds.add(member.id)`.
  3. In `apps/server/src/ws/connectionHandler.ts`:
     - Populate `isBot: room.isBot(m.member_id)` when building `rawMembers` and `selfMember`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test src/rooms/rooms.test.ts`
  Expected: PASS

---

### Task 3: `BotStormManager` Core Implementation

**Files:**
- Create: `apps/server/src/rooms/botStormManager.ts`
- Create: `apps/server/src/rooms/botStormManager.test.ts`

**Interfaces:**
- Consumes:
  - `SyncClient` from `@tether/sync-client`
  - `FaultyWebSocket` from `@tether/sync-client/testing`
  - `JoinService`, `MemberRepo`, `RoomRegistry`, `AuditService` from `@tether/server`
- Produces:
  - `export class BotStormManager`:
    - `startStorm(options: { roomId: string; hostMemberId: string; bots: number; seconds: number; faults: boolean; port: number }): Promise<void>`
    - `stopStorm(roomId: string): Promise<void>`
    - `isStormActive(roomId: string): boolean`
    - `destroyAll(): Promise<void>`

- [ ] **Step 1: Write failing unit tests for `BotStormManager`**
  Create `apps/server/src/rooms/botStormManager.test.ts`:
  1. Test starting a storm creates the requested number of bot clients.
  2. Test preventing concurrent storms in the same room (`isStormActive` returns true and throws or rejects).
  3. Test stopping/undoing the storm removes bot text and leaves the room.
  4. Test `destroyAll()` terminates all active storms gracefully.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/server test src/rooms/botStormManager.test.ts`
  Expected: FAIL (`botStormManager.ts` not found).

- [ ] **Step 3: Implement `BotStormManager`**
  Create `apps/server/src/rooms/botStormManager.ts`:
  - `BOT_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta']`
  - `SNIPPETS = ['const ', 'let x = 1;', '\n', '// bot\n', 'fn()', ' + ', 'return ', '{}', '[]', 'await ', 'if (ok) ']`
  - For each bot:
    - Mint token via `joinService.issueRoomToken`.
    - Upsert member in `memberRepo` with `name: 'Bot ' + BOT_NAMES[i]`.
    - Mark bot in `room.markBot(memberId)`.
    - Connect `SyncClient` with loopback URL `ws://127.0.0.1:${port}/ws/rooms/${roomId}`. If `faults=true`, inject `FaultyWebSocket`.
    - Attach `Y.UndoManager` tracking `origin: botId`.
    - Run interval typing loop: random insert/delete of snippets, update cursor in awareness.
  - Setup timeout for `seconds * 1000` ms:
    - Stop typing loop.
    - Execute `while (undoManager.canUndo()) undoManager.undo()`.
    - Await quiescence / flush.
    - Disconnect `syncClient.leave()` and destroy.
    - Log audit event `demo.storm_completed`.
    - Remove from `activeStorms`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test src/rooms/botStormManager.test.ts`
  Expected: PASS

---

### Task 4: Server Wiring & WebSocket `demo.storm` Integration

**Files:**
- Modify: `apps/server/src/ws/upgradeGate.ts`
- Modify: `apps/server/src/ws/connectionHandler.ts`
- Modify: `apps/server/src/http/app.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/tests/integration/botStormIntegration.test.ts`

**Interfaces:**
- Consumes:
  - `BotStormManager`
- Produces:
  - `connectionHandler.ts`: On `case 'demo.storm'`, validates `DEMO_MODE`, host permission, room capacity, and absence of active storm, then delegates to `botStormManager.startStorm(...)`.
  - Graceful shutdown in `index.ts` calls `await botStormManager.destroyAll()`.

- [ ] **Step 1: Write integration test for `demo.storm` via WebSocket**
  Create `apps/server/tests/integration/botStormIntegration.test.ts`:
  - Launch Fastify server with `DEMO_MODE: true`.
  - Connect host client over WebSocket.
  - Send `{ t: 'demo.storm', bots: 2, seconds: 2, faults: false, rid: 'storm-1' }`.
  - Verify server responds `{ t: 'ok', rid: 'storm-1' }`.
  - Verify host receives `member.joined` for 2 bots with `isBot: true`.
  - Verify host receives text updates from the bots.
  - Verify after 2 seconds, bot text is undone and bots leave with `member.left`.
  - Verify audit event `demo.storm_completed` is emitted and logged.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/server test tests/integration/botStormIntegration.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Wire `BotStormManager` into server and connection handler**
  1. In `apps/server/src/ws/upgradeGate.ts`: add `botStormManager?: BotStormManager` to `UpgradeGateDependencies`.
  2. In `apps/server/src/http/app.ts`: add `botStormManager?: BotStormManager` to `AppDependencies`.
  3. In `apps/server/src/ws/connectionHandler.ts`:
     - In `case 'demo.storm'`:
       ```typescript
       if (deps.botStormManager?.isStormActive(room.id)) {
         ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'conflict', message: 'Bot storm already in progress' }));
         return;
       }
       const currentMembers = deps.memberRepo.getMembers(room.id);
       if (currentMembers.length + msg.bots > MAX_MEMBERS_PER_ROOM) {
         ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'bad_request', message: 'Room capacity exceeded' }));
         return;
       }
       ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
       deps.auditService.logEvent(room.id, {
         type: 'demo.storm',
         actorMemberId: member.id,
         actorName: member.name,
         payload: { bots: msg.bots, seconds: msg.seconds, faults: msg.faults },
       });
       void deps.botStormManager?.startStorm({
         roomId: room.id,
         hostMemberId: member.id,
         bots: msg.bots,
         seconds: msg.seconds,
         faults: msg.faults,
         port: deps.config.PORT,
       });
       ```
  4. In `apps/server/src/index.ts`:
     - Instantiate `const botStormManager = new BotStormManager(deps);`
     - Provide dynamic port getter `() => serverPort`.
     - In shutdown hook, call `await botStormManager.destroyAll()`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/server test tests/integration/botStormIntegration.test.ts`
  Expected: PASS

---

### Task 5: Web Client Storm State Forwarding (`server-sync-client.ts`)

**Files:**
- Modify: `apps/web/lib/sync/server-sync-client.ts`
- Test: `apps/web/lib/sync/server-sync-client.test.ts`

**Interfaces:**
- Consumes:
  - `AuditEvent` with `type: 'demo.storm'` and `type: 'demo.storm_completed'`
- Produces:
  - Updates `client.storm` store with `{ running: true, bots, endsAt, ops }` on `demo.storm` and `{ running: false, result: ... }` on completion.

- [ ] **Step 1: Write unit test in `apps/web/lib/sync/server-sync-client.test.ts`**
  Verify that when an audit event `{ type: 'demo.storm', payload: { bots: 3, seconds: 20 } }` arrives, `client.storm.get()` updates to `running: true`. When `demo.storm_completed` arrives, `running` updates to `false`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @tether/web test lib/sync/server-sync-client.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement event listener in `ServerSyncClient`**
  In `apps/web/lib/sync/server-sync-client.ts`, add event listener in constructor:
  - On `event.type === 'demo.storm'`: update `this.storm.set({ running: true, bots: payload.bots, endsAt: Date.now() + payload.seconds * 1000, ops: 0, result: null })`.
  - On `event.type === 'demo.storm_completed'`: update `this.storm.set({ running: false, bots: 0, endsAt: null, ops: payload.ops, result: { ... } })`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter @tether/web test lib/sync/server-sync-client.test.ts`
  Expected: PASS

---

### Task 6: Full Monorepo Verification & Chaos Test Pass

**Files:**
- None (verification across monorepo)

- [ ] **Step 1: Recompile shared packages**
  Run: `pnpm --filter @tether/shared build:pkg && pnpm --filter @tether/sync-client build:pkg`
  Expected: Code 0.

- [ ] **Step 2: Run full unit & integration tests**
  Run: `pnpm test`
  Expected: All tests pass across `@tether/shared`, `@tether/sync-client`, `@tether/server`, `@tether/web`, and `@tether/chaos`.

- [ ] **Step 3: Run TypeScript typecheck**
  Run: `pnpm typecheck`
  Expected: 0 errors across all workspaces.

- [ ] **Step 4: Run ESLint**
  Run: `pnpm lint`
  Expected: 0 warnings and 0 errors.

- [ ] **Step 5: Run Chaos CI**
  Run: `pnpm chaos:ci`
  Expected: 100% convergence.

---

## Verification Plan

### Automated Tests
- Unit tests:
  - `pnpm --filter @tether/sync-client test`
  - `pnpm --filter @tether/server test`
  - `pnpm --filter @tether/web test`
- Monorepo tests:
  - `pnpm test`
- TypeScript check:
  - `pnpm typecheck`
- Linter:
  - `pnpm lint`
- Chaos convergence:
  - `pnpm chaos:ci`

### Manual Verification
1. Start server with demo mode:
   ```env
   DEMO_MODE=true
   ```
2. Start development servers: `pnpm dev`
3. In browser, navigate to a room (e.g. `http://localhost:3001/r/test-storm`).
4. As host, open the diagnostics drawer / Network Lab tab and click "Start Storm" (e.g. 4 bots, 10 seconds, faults enabled).
5. Verify in UI:
   - 4 bot members appear in the Roster with bot badges (`isBot: true`).
   - Bot cursors appear and type tagged snippets across the editor.
   - Latency HUD and activity feed update live.
   - After 10 seconds, bot edits cleanly undo and the text reverts to its original state.
   - SyncBadge returns to "Verified in sync".
