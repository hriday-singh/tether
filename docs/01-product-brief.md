# 01 — Product Brief

## Problem

Students need a shared room where several people edit the same code or notes at once, see who is
there and what they are doing, and never lose work to a flaky connection. Most demo-grade
collaborative editors look fine with two tabs on localhost and fall apart under real conditions:
throttled or dropped messages desync peers, reconnects duplicate or drop text, and the UI stutters
because every keystroke re-renders the whole page.

## Who uses it

- **Host:** creates a room, optionally sets a passcode, moderates (kick, lock, passcode, language).
- **Member:** joins with room ID (+ passcode), edits, sees presence and activity.
- **Evaluator / reviewer:** reads the README, runs it locally, runs the chaos suite, watches the
  latency panel. Every claim in the README must be reproducible by this person in under 10 minutes.

## Spec requirements mapped to our design

| # | Spec requirement | How we meet it | Where |
|---|------------------|----------------|-------|
| R1 | Split layout: synced editor, participant list, live activity audit feed | CodeMirror 6 + Yjs editor; roster panel; audit feed panel (live + paginated history). Desktop: split columns. Mobile: editor + tabbed bottom panel | [07](07-frontend.md) |
| R2 | Custom room IDs, optional passcodes, credentials validated before admission | REST join validates passcode (scrypt) and issues a signed room token. WebSocket upgrade verifies the token **before** the socket is accepted. Unauthorized = HTTP 401/403 at upgrade, no socket ever opens | [05](05-rooms-security-roles.md) |
| R3 | Sync insertions, deletions, cursors, line highlights; typing/presence badges | Yjs CRDT for text. Awareness for cursors, selections, line highlights (anchored with relative positions) and typing/idle/away status. Server binds awareness entries to the authenticated member | [03](03-sync-engine.md), [04](04-protocol.md) |
| R4 | Throttle connections sending >5 updates/s | Client batches to ≤5 frames/s. Server enforces a per-connection token bucket (5/s) on **outbound broadcast**, merging queued updates with `Y.mergeUpdates`, so throttling never drops text. Flood guard disconnects abusive sockets | [03](03-sync-engine.md#3-lossless-throttling) |
| R5 | Host = creator; on disconnect, admin transfers to oldest active member | Server-side election: earliest `joinedAt` among active members. 5 s grace for abrupt drops, instant on clean leave. All admin commands re-checked server-side | [05](05-rooms-security-roles.md#host-election) |
| R6 | Graceful abrupt disconnects, smooth reconnect | Heartbeats detect half-open sockets. Backoff with jitter. The local Y.Doc survives reconnect and resyncs through a state-vector handshake, so offline edits merge in. Local edits are also saved in IndexedDB, so a tab refresh while offline loses nothing | [03](03-sync-engine.md#4-reconnect--offline) |
| R7 | Public repo, detailed README (env, deps, local run) | README written last, from these docs; one-command `docker compose up` path | [09](09-operations.md) |

## Differentiators (what we show off)

1. **Chaos-tested convergence.** A seeded, reproducible test harness spins up N headless clients,
   fires random edits, random disconnects and injected latency, then asserts every document is
   identical and no surviving edit was lost. Runs in CI.
2. **Lossless throttling.** Throttling limits broadcast rate but never drops content, because Yjs
   updates are commutative, associative and idempotent and can be merged.
3. **Live latency panel.** RTT and edit-propagation p50/p95 shown in the app. A "Network lab" toggle
   (demo mode) lets a reviewer inject latency or go offline and watch the system heal.
4. **Honest connection UI.** Status pill (connected / syncing / reconnecting / offline) plus a count of
   unsent changes. Users always know whether their work is safe.
5. **Verified in sync (P1).** When the room goes quiet, the server sends a checksum of the document.
   Each client compares it with its own copy and shows "Verified in sync". Convergence is checked
   live in the product, not assumed.
6. **Bot storm (P2, demo mode).** One host button spawns up to 8 bots that type under injected faults,
   then undo their own text and leave. Every badge must go back to Verified and the text must be back
   to what it was before the storm.

## Collaboration UX (v1)

Picked from what users like in Google Docs, Figma, Live Share, Replit and CodeShare. All four read
presence data only, so none of them can put text sync at risk.

| Feature | Seen in | Notes |
|---------|---------|-------|
| Jump to / follow a member | Google Docs, Figma, Live Share, Replit | Click a roster row to jump. Eye toggle to follow. Your own typing, scrolling or `Esc` stops following |
| Off-screen cursor chips | Figma, Google Docs | "Alex ↑ L212" at the editor edge. Click to jump |
| Invite link + copy | CodeShare, all of them | `/r/<roomId>`. Never contains the passcode |
| Download / copy file | CoderPad, CodeShare | File extension from the room language. Also the recovery path for a kicked user |

Considered and left out: running code (big security scope, not in spec), chat, per-author text
colors, multiple files, accounts. Read-only viewers and history playback stay on the stretch list.

## Non-goals (v1)

- User accounts, login, OAuth. Identity is a guest display name.
- Multiple files per room / file tree.
- Running code, terminals, or language servers.
- Voice, video, chat (the audit feed is not a chat).
- Multi-instance horizontal scaling. Designed for it in [09](09-operations.md#scale-path), not built.
- Dark mode (tokens are semantic so it can be added later).
- Playwright E2E (off until explicitly requested).

## Success criteria (definition of "pakka")

| Criterion | Target | Verified by |
|-----------|--------|-------------|
| Convergence under chaos | 100% of seeds converge (CI: 50 seeds × 5 clients; nightly: 500 seeds × 8 clients) | Chaos harness |
| Zero loss | Every uniquely-tagged insert that no one deleted is present in the final doc | Chaos harness invariant |
| Throttle compliance | No 1 s sliding window has >5 broadcast frames originating from one connection | Throttle integration test |
| Throttle losslessness | A 100 updates/s flood still yields the exact final text on all peers | Throttle integration test |
| Isolated-edit latency (localhost) | p95 < 50 ms keystroke → peer apply | Latency bench |
| Burst-typing latency (localhost) | p95 < 250 ms (bounded by 200 ms throttle window + RTT) | Latency bench |
| Host handover | New host announced ≤ grace + 1 s after abrupt host drop | Integration test |
| No UI freeze | No long task > 50 ms in the workspace while 5 peers type (Chrome Performance panel) | Manual profiling, recorded in README |
| Unauthorized admission | 0 sockets opened without a valid token (bad token, wrong room, stale passcode version, banned, locked) | Integration tests |
| Live verification | Every client idle at the end of a chaos run reaches `Verified`; forced mismatch self-heals | Chaos harness + integration test |
| Feed exactly-once | After any disconnect, every client holds feed seqs 1..N exactly once (no duplicates, no gaps) | Integration test |
| Command idempotence | A repeated host command has exactly one effect and one audit event | Integration test |

## Open questions

- None blocking. Revisit "creator reclaims host on rejoin" (currently: no, see [05](05-rooms-security-roles.md)).
