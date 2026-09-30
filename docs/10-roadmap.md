# 10 — Roadmap & TODO

Order is deliberate: **engine and proof first, UI last.** If time runs out, we have a correct system
with a plain UI, not a pretty one that loses text.

Each milestone ends with: lint + typecheck + tests green, docs updated, no commit by Claude.

## Week 1: engine + proof

### M0: Repo foundation
- [x] pnpm workspace: `apps/web`, `apps/server`, `packages/shared`, `packages/sync-client` (`tests/chaos` in progress)
- [x] TypeScript strict everywhere, shared `tsconfig.base.json`
- [x] ESLint + Prettier
- [x] Vitest config per package
- [x] Dockerization: `apps/server/Dockerfile`, `apps/web/Dockerfile` (standalone), `docker-compose.yml` (web + server + persistent SQLite volume + optional postgres profile), `.dockerignore`, `.env.example`
- [x] GitHub Actions: lint, typecheck, unit, integration (SQLite in-memory), `chaos:ci`

### M1: Shared protocol
- [x] `constants.ts` (all limits from [04](04-protocol.md#limits-single-source-packagessharedsrcconstantsts))
- [x] Binary frame codec (`SYNC_STEP1`, `SYNC_STEP2`, `UPDATE`) + round-trip property tests
- [x] Zod control message schemas (both directions) + types
- [x] Token bucket (injected clock) + tests
- [x] Backoff calculator + tests
- [x] State-vector equality (decoded map compare) + text hash helpers + tests (P1)

### M2: Server core
- [x] Zod env config, pino with redaction
- [x] `migrations/0001_init.sql` generated for SQLite & PostgreSQL (user applies)
- [x] Repos: rooms, room_updates, room_members, audit_events
- [x] REST: create, get, join (scrypt, JWT, rate limits), events pagination; OpenAPI output (REST complete & tested)
- [x] Create `Idempotency-Key` + `409 room_taken` suggestion; `GET /admission` probe; events `after=`
- [x] Upgrade gate: full admission checklist
- [x] Room + RoomRegistry: load (snapshot + tail), handshake, broadcast, unload
- [x] Persistence: 250 ms flush, acks after commit, compaction, DB-outage retry, bounded buffer
- [x] Graceful shutdown
- [x] Integration tests: admission, persistence, restart

### M3: Sync client
- [x] `SyncClient`: connect via subprotocol token, handshake, status store
- [x] Leading-edge 200 ms batcher (doc merge + latest awareness)
- [x] Seq + ack tracking, pending count
- [x] Heartbeat, dead-connection detection, jittered backoff, close-code policy
- [x] y-indexeddb restore-before-connect, epoch-scoped keys, clear on leave/kick/reset
- [x] Stats store: RTT, ack latency (p50/p95)
- [x] Wake fast path (visibility / focus / pageshow / online probe, `WAKE_PROBE_MS`)
- [x] Classify pre-`welcome` failures via admission probe; `reauth` keeps local copy
- [x] P1 client: `checksum` handling, reset-from-server on mismatch, verified state
- [x] Injected WebSocket constructor (browser + Node)

### M4: Throttling
- [x] `OutboundThrottle` (merge-on-queue) + unit tests in fake time
- [x] Inbound flood guard, frame cap, slow-consumer close
- [x] `throttled` notice + audit (rate-limited)
- [x] Throttle + flood integration tests

### M5: Chaos harness (gate for UI) — [COMPLETE]
- [x] `FaultyTransport` (ordered delay, abrupt kill, inbound pause) in `packages/sync-client/src/testing/`
- [x] Seeded action generator + invariant checks I1–I4 + ack + DB reload
- [x] `chaos:ci` in CI, `chaos:nightly` scheduled
- [x] Regression test template for failing seeds
- [x] Latency bench script + first numbers recorded
- [x] P1 server: quiet-room `checksum` emitter, `verify.mismatch` metric; chaos invariant "all Verified" (server emitter complete)

## Week 2: features + UI

### M6: Presence
- [x] Awareness identity binding (clientID claim, memberId match, Zod, size cap)
- [x] Typing / idle / away status
- [x] Line highlights with relative positions
- [x] Spoofing tests

### M7: Rooms & roles
- [x] Member set with grace timers, pure `electHost` + tests
- [x] Host commands: kick/ban, lock, passcode (version bump), transfer, language
- [x] Sliding token refresh
- [x] Handover timing + race tests
- [x] Command `rid` + `ok`/`error`; idempotent-by-state commands + tests
- [x] Duplicate display-name suffixing

### M8: Audit feed
- [x] Event emission for all types in [06](06-data-model.md#audit-event-types) (AuditRepo + basic logging in place)
- [x] Edit-summary coalescer (5 s idle / 30 s max) + tests
- [x] Live `event` push + REST pagination: per-room gapless `seq`, push after commit, client dedupe + gap-fill, tests (REST pagination complete)

### M9: Web UI — [COMPLETE]
- [x] Token file (`globals.css`), Tailwind v4 theme, UI primitives
- [x] Home (create/join), join gate
- [x] Workspace layout: desktop resizable split + small screen barrier (`<ScreenTooSmallGate />`)
- [x] Editor (lazy), remote cursors, highlights, language picker
- [x] Roster, ActivityFeed (virtualized, infinite), StatusPill, LatencyHud, HostMenu
- [x] Network Lab (demo mode)
- [x] Follow / jump-to-user, off-screen cursor chips, invite link, export menu
- [x] SyncBadge (P1), KickedScreen with Copy my version, reauth flow keeping local edits
- [x] P2 bot storm: server spawner (demo mode) + StormPanel
- [x] RTL tests for non-trivial components
- [x] Verify small screen lockout (< 1024px) & desktop workspace (≥ 1024px); performance profile (no long task > 50 ms)

### M10: Ship — [COMPLETE]
- [x] Bench numbers + perf metrics recorded in README and testing doc
- [x] README: pitch, architecture diagram, env, install, run, test, chaos, guarantees + honest limits
- [x] `docker compose up` full-stack path verified from clean clone
- [x] Docs re-synced with code

### M11: Text chat (after M10, [ADR-017](11-decisions.md#adr-017-text-chat-in-voice-chat-out-amends-adr-015))
- [x] Protocol: `chat.send` / `chat.msg`, `welcome.chatSeq`, chat limits in constants
- [x] Server: `chat_messages` table (migration 0002), ChatRepo/ChatService, per-connection chat bucket, REST `GET /api/rooms/:id/chat`
- [x] Web: generic seq store, `Textarea` primitive, Chat sidebar tab (unread badge, pending/failed states), fake client support
- [x] Server sync client wiring (needs connect-frontend plan Tasks 1 + 3)
- [x] Docs 04/06/07 synced

Voice chat is out, see ADR-017.

## Week 3: stretch (in priority order)

- [ ] Read-only viewer role (host toggles; server rejects `SYNC_STEP2`/`UPDATE` doc part for viewers)
- [ ] Version history: named Yjs snapshots + time-travel view
- [ ] Room expiry job (inactive 30 days) + audit retention (90 days)
- [ ] Deploy to AWS: ALB + ECS Fargate + RDS, SSM secrets, public demo URL
- [ ] Multi-instance: room-affinity routing + Redis rate limits ([09](09-operations.md#scale-path))
- [ ] Load test at scale (k6 or custom): 100 rooms × 10 clients, publish numbers
- [ ] Playwright E2E for critical flows (only after explicit go-ahead)
- [ ] Dark mode (tokens already semantic)
- [ ] P3 public chaos report: CI publishes seeds, faults, invariant results, latency histogram as a static page

## Adopted additions (decided 2026-09-29)

See [11](11-decisions.md#adr-012-verifiable-sync-accepted-p1--p2). P1 and P2 are adopted and scheduled in
M3, M5 and M9 above. P3 (public chaos report page) moved to the week-3 stretch list.
