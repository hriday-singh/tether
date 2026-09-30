# 08 — Testing & Verification

The chaos harness is the **proof** of the pitch. UI work (milestone M9) does not start until it
runs green in CI.

## Pyramid

| Layer | Tool | What |
|-------|------|------|
| Unit | Vitest | Pure units with fake clocks: token bucket, HostElector, OutboundThrottle, client batcher, frame codec, Zod schemas, backoff calculator, edit-summary coalescer |
| Property | Vitest + `fast-check` | Codec round-trip; batcher never emits > 5 frames in any 1 s window; merge-then-apply ≡ apply-each; election always picks min `joinedAt` |
| Integration (server) | Vitest + SQLite (in-memory `:memory:` or test file; PostgreSQL optional) + in-process server | REST, admission checklist, persistence/compaction, host handover timing, kick/ban, throttle, flood close |
| Chaos | Vitest, `tests/chaos/`, N × `SyncClient` in Node against the real server | Convergence + no-loss invariants under random faults |
| Frontend | Vitest + React Testing Library | StatusPill states, Roster rendering from store, ActivityFeed pagination merge, join form validation, host-only UI gating |
| Bench | Node script `tests/chaos/bench.ts` | Edit propagation latency distribution |
| E2E | Playwright | **Off** until explicitly requested |

## Chaos harness

```
seed = CHAOS_SEED ?? random          (printed on failure; re-run with CHAOS_SEED=<n>)
start server (in-process, fresh room, SQLite DB)
spawn N clients (SyncClient over a FaultyTransport wrapping `ws`)
repeat STEPS times, choose weighted-random action:
  insert tagged text at random pos     (tag = `⟦c{client}#{n}⟧`, recorded)
  delete random range                  (records which tags were removed)
  move cursor / set highlight
  burst: 50 inserts in 100 ms          (forces throttle path)
  disconnect client k (abrupt: terminate, no close frame)
  reconnect client k
  set latency on client k (0–500 ms, jittered)
  pause client k inbound (simulates slow consumer → 4008 path)
  restart server (graceful)            (nightly only)
heal: remove latency, reconnect everyone, wait for quiescence (no frames for 1 s)
assert:
  I1 all client texts == server text
  I2 every tag inserted and never covered by a delete is present exactly once
  I3 no tag appears twice
  I4 per-source broadcast log: no 1 s window > 5 frames
  all clients show status Saved (every seq acked)
  DB reload: new Y.Doc from snapshot + tail == server text
```

`FaultyTransport` (in `packages/sync-client/src/testing/`, shared with the P2 bot storm) is a thin wrapper around the socket. It delays frames by a
configurable, jittered amount while **preserving order** (TCP semantics) and can terminate abruptly.
It never reorders or corrupts frames, because TCP doesn't. We test real failure modes, not impossible ones.

| Profile | Seeds | Clients | Steps | Runs |
|---------|-------|---------|-------|------|
| `chaos:ci` | 50 | 5 | 300 | Every PR |
| `chaos:nightly` | 500 | 8 | 2 000 + server restarts | Scheduled workflow |

A failing seed becomes a permanent regression test (`tests/chaos/regressions/<seed>.test.ts`).

## Specific integration tests (must exist)

- Admission: each of the 8 checks in [05](05-rooms-security-roles.md#admission-checklist-enforced-in-order-at-upgrade)
  rejects with the right HTTP status and **no socket is opened** (assert `wss.clients.size`).
- Throttle: client sends 100 raw `UPDATE` frames/s (bypassing the batcher) for 3 s → peers receive
  ≤ 5 frames/s from it, final text identical, `throttled` notice sent once per 10 s.
- Flood: 60 frames/s for 3 s → `4029`, content before close preserved.
- Host: abrupt host drop → `host.changed` after 5 s ± 250 ms to oldest; reconnect at 3 s → no change;
  clean `leave` → immediate.
- Race: host command sent in the same tick as handover → `forbidden`, no effect.
- Awareness spoof: entry with another member's `memberId` or foreign clientID is not re-broadcast.
- Persistence: kill DB mid-session → acks stop, edits continue; DB back → acks resume, no loss.
- Restart: graceful shutdown → reload → content identical; clients reconnect and converge.
- IndexedDB (sync-client unit, fake-indexeddb): offline edits + reload → edits present after reconnect.
- Feed exactly-once: disconnect a client, emit 20 events, reconnect → client holds seqs 1..N exactly
  once. REST page overlapping live pushes → no duplicates. Failed flush retried → seqs still gapless.
- Command idempotence: `host.kick` sent twice → one ban, one audit event, two `ok` replies with
  matching `rid`. Same for lock, language, same passcode.
- Create retry: same `Idempotency-Key` twice → `201` then `200` with the same room. Other key, same
  ID → `409 room_taken` with a suggestion that is actually free.
- Admission probe: every rejection reason maps to the right `status`. The client stops its reconnect
  loop on anything but `ok`, and keeps its IndexedDB copy on `reauth`.
- Wake path (sync-client unit, fake timers): `visibilitychange` with a dead socket → reconnect within
  `WAKE_PROBE_MS`, no backoff delay.
- Checksum (P1): quiet room → every client reaches Verified. State vectors with different client-ID
  insertion orders still compare equal. A forced local divergence → `verify.mismatch`, reset from
  server, back to Verified. Chaos runs also assert every client ends Verified.

## Bot storm (P2, demo mode)

Off unless `DEMO_MODE=true`. Otherwise `demo.storm` gets `error forbidden`. One storm per room at a time.

- The server spawns N bots in-process: `packages/sync-client` over a real loopback WebSocket, wrapped in
  the same `FaultyTransport` as the chaos harness (it lives in `packages/sync-client/src/testing/` so
  both can use it). Bots get server-minted tokens, pass the normal admission gate, count toward
  `MAX_MEMBERS_PER_ROOM`, and show with `isBot`.
- Each bot types random tagged snippets at random positions at human-like rates. With `faults` on, it
  also randomly delays, pauses and kills its own connection.
- At the end, each bot undoes all of its own changes with its own `Y.UndoManager`, then leaves.
- Expected, visible to everyone in the room: every badge returns to Verified and the text is back to
  its pre-storm state. The exception is humans editing inside bot text during the storm, which leaves
  that text in place by design (undo only removes the bot's own inserts).

## Latency bench

`pnpm bench`: 1 room, 5 clients on localhost.
- Isolated edits (1 per second per client): report p50/p95/p99 keystroke → peer apply.
- Burst typing (15 chars/s per client): same metrics.

### Measured results (localhost, 5 clients)

| Benchmark Scenario | Samples | Min | p50 | p95 | p99 | Max | Mean |
|--------------------|---------|-----|-----|-----|-----|-----|------|
| **Isolated Edits** | 200 | 0.67 ms | 1.60 ms | 6.27 ms | 13.06 ms | 13.26 ms | 2.50 ms |
| **Burst Typing** | 500 | 1.41 ms | 8.33 ms | 124.26 ms | 142.71 ms | 143.31 ms | 37.46 ms |

All measured numbers comfortably meet the targets in [01](01-product-brief.md#success-criteria-definition-of-pakka) (isolated p95 < 50 ms, burst p95 < 250 ms).

## Done means

Lint (ESLint + Prettier), `tsc --noEmit`, unit + integration + `chaos:ci` all green (275+ tests across 60 test suites). CI (GitHub Actions) runs them on every PR. With SQLite in-memory mode, tests run fast without waiting on external database container spin-up. If PostgreSQL integration is enabled, CI can optionally run against a Postgres service container.

