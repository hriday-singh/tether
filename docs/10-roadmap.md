# 10 — Roadmap & TODO

Order is deliberate: **engine and proof first, UI last.** If time runs out, we have a correct system
with a plain UI, not a pretty one that loses text.

Each milestone ends with: lint + typecheck + tests green, docs updated, no commit by Claude.

## Week 1: engine + proof

### M0: Repo foundation
- [ ] pnpm workspace: `apps/web`, `apps/server`, `packages/shared`, `packages/sync-client`, `tests/chaos`
- [ ] TypeScript strict everywhere, shared `tsconfig.base.json`
- [ ] ESLint + Prettier, Husky + lint-staged
- [ ] Vitest config per package
- [ ] `docker-compose.yml` (EC2 ready: web + server + persistent volume for SQLite; optional postgres compose profile), `.env.example`
- [ ] GitHub Actions: lint, typecheck, unit, integration (SQLite in-memory), `chaos:ci`

### M1: Shared protocol
- [ ] `constants.ts` (all limits from [04](04-protocol.md#limits-single-source-packagessharedsrcconstantsts))
- [ ] Binary frame codec (`SYNC_STEP1`, `SYNC_STEP2`, `UPDATE`) + round-trip property tests
- [ ] Zod control message schemas (both directions) + types
- [ ] Token bucket (injected clock) + tests
- [ ] Backoff calculator + tests
- [ ] State-vector equality (decoded map compare) + text hash helpers + tests (P1)

### M2: Server core
- [ ] Zod env config, pino with redaction
- [ ] `migrations/0001_init.sql` generated for SQLite & PostgreSQL (user applies)
- [ ] Repos: rooms, room_updates, room_members, audit_events
- [ ] REST: create, get, join (scrypt, JWT, rate limits), events pagination; OpenAPI output
- [ ] Create `Idempotency-Key` + `409 room_taken` suggestion; `GET /admission` probe; events `after=`
- [ ] Upgrade gate: full admission checklist
- [ ] Room + RoomRegistry: load (snapshot + tail), handshake, broadcast, unload
- [ ] Persistence: 250 ms flush, acks after commit, compaction, DB-outage retry, bounded buffer
- [ ] Graceful shutdown
- [ ] Integration tests: admission, persistence, restart

### M3: Sync client
- [ ] `SyncClient`: connect via subprotocol token, handshake, status store
- [ ] Leading-edge 200 ms batcher (doc merge + latest awareness)
- [ ] Seq + ack tracking, pending count
- [ ] Heartbeat, dead-connection detection, jittered backoff, close-code policy
- [ ] y-indexeddb restore-before-connect, epoch-scoped keys, clear on leave/kick/reset
- [ ] Stats store: RTT, ack latency (p50/p95)
- [ ] Wake fast path (visibility / focus / pageshow / online probe, `WAKE_PROBE_MS`)
- [ ] Classify pre-`welcome` failures via admission probe; `reauth` keeps local copy
- [ ] P1 client: `checksum` handling, reset-from-server on mismatch, verified state
- [ ] Injected WebSocket constructor (browser + Node)

### M4: Throttling
- [ ] `OutboundThrottle` (merge-on-queue) + unit tests in fake time
- [ ] Inbound flood guard, frame cap, slow-consumer close
- [ ] `throttled` notice + audit (rate-limited)
- [ ] Throttle + flood integration tests

### M5: Chaos harness (gate for UI)
- [ ] `FaultyTransport` (ordered delay, abrupt kill, inbound pause) in `packages/sync-client/src/testing/`
- [ ] Seeded action generator + invariant checks I1–I4 + ack + DB reload
- [ ] `chaos:ci` in CI, `chaos:nightly` scheduled
- [ ] Regression test template for failing seeds
- [ ] Latency bench script + first numbers recorded
- [ ] P1 server: quiet-room `checksum` emitter, `verify.mismatch` metric; chaos invariant "all Verified"

## Week 2: features + UI

### M6: Presence
- [ ] Awareness identity binding (clientID claim, memberId match, Zod, size cap)
- [ ] Typing / idle / away status
- [ ] Line highlights with relative positions
- [ ] Spoofing tests

### M7: Rooms & roles
- [ ] Member set with grace timers, pure `electHost` + tests
- [ ] Host commands: kick/ban, lock, passcode (version bump), transfer, language
- [ ] Sliding token refresh
- [ ] Handover timing + race tests
- [ ] Command `rid` + `ok`/`error`; idempotent-by-state commands + tests
- [ ] Duplicate display-name suffixing

### M8: Audit feed
- [ ] Event emission for all types in [06](06-data-model.md#audit-event-types)
- [ ] Edit-summary coalescer (5 s idle / 30 s max) + tests
- [ ] Live `event` push + REST pagination: per-room gapless `seq`, push after commit, client dedupe + gap-fill, tests

### M9: Web UI
- [ ] Token file (`globals.css`), Tailwind v4 theme, UI primitives
- [ ] Home (create/join), join gate
- [ ] Workspace layout: desktop split + mobile tabs/sheet
- [ ] Editor (lazy), remote cursors, highlights, language picker
- [ ] Roster, ActivityFeed (virtualized, infinite), StatusPill, LatencyHud, HostMenu
- [ ] Network Lab (demo mode)
- [ ] Follow / jump-to-user, off-screen cursor chips, invite link, export menu
- [ ] SyncBadge (P1), KickedScreen with Copy my version, reauth flow keeping local edits
- [ ] P2 bot storm: server spawner (demo mode) + StormPanel
- [ ] RTL tests for non-trivial components
- [ ] Verify mobile + desktop; performance profile (no long task > 50 ms)

### M10: Ship
- [ ] Bench numbers + perf screenshot in README
- [ ] README: pitch, architecture diagram, env, install, run, test, chaos, guarantees + honest limits
- [ ] `docker compose up` full-stack path verified from clean clone
- [ ] Docs re-synced with code

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
