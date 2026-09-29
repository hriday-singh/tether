# 11 — Decisions Log (ADRs)

Format: context, decision, consequences. Newest at the bottom. Superseded ADRs stay, marked as such.

## ADR-001: Core pitch is zero-loss sync + measured latency
- **Context:** spec lists many features; reviewers see dozens of similar collaborative editors.
- **Decision:** the showcase is correctness under failure (convergence, no loss) plus measured latency,
  proven by an automated chaos suite. Features are table stakes.
- **Consequences:** engine + harness are built before the UI. Features that risk invariants get cut.

## ADR-002: Yjs v13 CRDT, not custom OT/CRDT
- **Context:** we need provable convergence under reconnects and batching. Custom algorithms carry
  high risk of subtle bugs.
- **Decision:** Yjs v13. Its updates are commutative, associative and idempotent, which enables lossless merge
  throttling and a single recovery path. Pinned to v13 because the `y-codemirror.next` README says the v14
  (`@y/y`) binding is the unstable development branch.
- **Consequences:** the merge math is borrowed and battle-tested. Our engineering goes into the server,
  protocol, throttling, recovery and proof.

## ADR-003: Own WebSocket server, not y-websocket / Hocuspocus
- **Context:** Hocuspocus's Throttle extension limits connection attempts per IP (ban after N/min), not
  per-connection message rate. We need per-connection lossless broadcast throttling, server-bound
  presence identity, durable acks, host election and audit anyway.
- **Decision:** thin server on `ws` + Yjs/y-protocols primitives with our own envelope.
- **Consequences:** more code to own and test. The chaos harness covers it.

## ADR-004: Own binary envelope over y-protocols framing
- **Context:** we need a sequence number (durable acks → "Saved" indicator) and one combined
  doc+awareness frame per throttle tick (so "5 updates/s" means 5 frames).
- **Decision:** `SYNC_STEP1 / SYNC_STEP2 / UPDATE` envelope using lib0 varints; inside we still use
  `Y.encodeStateVector`, `Y.encodeStateAsUpdate`, `encodeAwarenessUpdate`.
- **Consequences:** not wire-compatible with stock y-websocket providers. That's acceptable because we ship our own client.

## ADR-005: Throttle outbound broadcast, never drop doc updates
- **Context:** dropping CRDT updates causes divergence until the next full resync.
- **Decision:** apply inbound immediately; rate-limit **broadcast** per source with a token bucket
  (5/s, burst 5), merging queued updates. Separate inbound flood guard for abuse.
- **Consequences:** peers see batched text during bursts (≤ 200 ms extra). Zero loss.

## ADR-006: Guest identity + room JWT in WebSocket subprotocol
- **Context:** no accounts (scope). Browser WebSocket API can't set custom headers. Query-string tokens leak into logs.
- **Decision:** REST join validates passcode, issues HS256 JWT (24 h, sliding refresh). Sent as the second
  `Sec-WebSocket-Protocol` value, verified before `handleUpgrade`.
- **Consequences:** kick/ban is per member ID, and a determined user can get a new ID. Mitigated by passcode
  rotation and room lock. Documented.

## ADR-007: Host handover with 5 s grace
- **Context:** instant transfer on every Wi-Fi blip makes host flap.
- **Decision:** abrupt drop → 5 s grace (env), clean leave → instant. Seniority (`joinedAt`) survives
  reconnects within grace. Creator does not auto-reclaim.
- **Consequences:** up to 5 s with a "reconnecting" host after a real drop. Deterministic tests.

## ADR-008: Single process v1, room affinity for scale
- **Decision:** v1 runs one process. The documented scale path is room-affinity routing, not Redis fan-out
  (Hocuspocus docs: with Redis, all messages are handled on all instances).
- **Consequences:** simpler failure model now. Horizontal scale is a routing change, not a sync redesign.

## ADR-009: CodeMirror 6 over Monaco
- **Decision:** CodeMirror 6: smaller bundle, works on mobile, stable Yjs binding with remote
  cursors and per-user undo.
- **Consequences:** fewer IDE features (no IntelliSense), which matches the non-goals.

## ADR-010: Database engine & persistence (SQLite for POC, PostgreSQL for Production Scale)
- **Context:** The system needs durable persistence for room snapshots, merged update logs (flushed every 250 ms), member records, and gapless audit events. Keystroke sync itself is entirely in-memory (Yjs + WebSockets).
- **Decision:** Use **SQLite** (via `better-sqlite3` with Write-Ahead Logging `WAL` mode) for local development, automated testing, and single-node Docker Compose deployments. Maintain a 1:1 mapped **PostgreSQL** schema ([06](06-data-model.md)) and repository pattern abstraction (`apps/server/src/repo/`) for enterprise multi-node production scale (AWS RDS PostgreSQL).
- **Consequences:** Zero external database dependencies for local development and CI; instant in-memory test runs; Docker Compose runs seamlessly on a single EC2 instance with a mounted volume; clean migration path to AWS RDS PostgreSQL when horizontal scaling is required. Acked edits remain 100% durable.

## ADR-011: IndexedDB local copy in v1
- **Context:** "never lose a keystroke" must include refreshing the tab while offline.
- **Decision:** `y-indexeddb`, epoch-scoped key, cleared on leave/kick/reset.
- **Consequences:** doc content persists on the device, which matters on shared computers. The "Leave & clear" action addresses that.

## ADR-012: Verifiable sync (accepted: P1 + P2)
- **Context:** Yjs + CodeMirror is a common stack. Most collaborative editors **assume** peers are in sync and never
  check. Our claim needs to be visible to a reviewer in the running app, not only in CI.
- **Decision:** P1: quiet-room `checksum {sv, hash}`, clients compare decoded state vectors and hashes,
  show "Verified in sync", and reset from the server on mismatch ([03](03-sync-engine.md#47-verified-in-sync-p1)).
  P2: demo-mode bot storm that reuses the chaos harness transport ([08](08-testing-and-verification.md#bot-storm-p2-demo-mode)).
  P3 (public chaos report page) deferred to stretch.
- **Status:** accepted 2026-09-29.

## ADR-013: Feed events get a per-room gapless `seq`
- **Context:** feed events are plain messages without CRDT guarantees. Live push + REST history overlap (duplicates),
  and events sent during a disconnect are lost (gaps). A global `bigserial` isn't guaranteed to match commit order.
- **Decision:** per-room `seq` assigned by the room owner at flush time, `UNIQUE (room_id, seq)`, push only after
  commit, `welcome.eventSeq` + `GET /events?after=` gap-fill, client map keyed by `seq`.
- **Consequences:** exactly-once feed per client. Relies on single-owner rooms, which room affinity keeps at scale.

## ADR-014: Admission probe for rejected upgrades
- **Context:** browsers expose a refused WebSocket upgrade only as close `1006`, the same as a network drop, so
  "401 goes to the join gate" can't be implemented from the close event.
- **Decision:** `GET /api/rooms/:id/admission` runs the same checks and returns a reason. The client calls it when
  an attempt fails before `welcome` while online. Keeps "no socket opens without a valid token" intact.
- **Alternative rejected:** accept the socket, then close with a 44xx code. Breaks the literal admission guarantee.

## ADR-015: Collaboration UX limited to presence-only features
- **Context:** competitors offer many features. The pitch says features must not threaten sync.
- **Decision:** v1 adds follow / jump, off-screen cursor chips, invite link, export. All read awareness only.
  Chat, per-author colors and multi-file stay out. (Code preview and client-side execution boundaries amended in ADR-016).

## ADR-016: Client-Side Sandboxed Preview, DevTools Console, Multi-Theme Engine, and Dual Morphing
- **Context:** Users require an impressive, responsive developer experience with live HTML/JS preview and execution feedback without introducing server-side remote code execution risks or ballooning infrastructure costs. In addition, theme accessibility requires equal dark and light mode support with seamless state transitions.
- **Decision:**
  1. **Client-Side Isolated Preview:** Sandboxed `<iframe sandbox="allow-scripts" srcdoc>` with an opaque origin (`null`). Zero server execution, no container orchestration, and zero access to parent cookies or `localStorage`.
  2. **Client-Side JS/TS Runner:** Dedicated Web Worker with a strict 5-second watchdog timer to safely terminate infinite loops without freezing the UI.
  3. **DevTools Console Panel:** Intercepts `console.*` and runtime errors via `postMessage` into a resizable bottom drawer.
  4. **Multi-Theme Engine:** Quiet Dark (default), Quiet Light (clean paper equivalent), and High-Contrast modes, switchable via VS Code-style `⌘K` QuickPick with live keyboard arrow preview.
  5. **Dual Morphing System:** `morphicons` for vector SVG path morphs (copy ➔ check, play ➔ stop) paired with `torph` (`<TextMorph />`) for character-level label text morphs.
  6. **Zero-Emoji Policy:** 100% vector SVG iconography using `Hugeicons stroke-rounded` and `theSVG` brand logos across all UI states and notifications.
- **Consequences:** Extends frontend capability safely with zero server-side attack surface. Documented in full detail in `docs/ui-ux/`.

## Research sources (fetched 2026-09-29)

- y-protocols spec: https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md (sync handshake,
  awareness semantics, 30 s awareness timeout, "awareness payloads are not authenticated",
  read-only enforcement by message prefix)
- Yjs document updates: https://docs.yjs.dev/api/document-updates (commutative/associative/idempotent,
  `mergeUpdates`, `diffUpdate`, state vectors, transaction origin for providers)
- y-codemirror.next README: https://github.com/yjs/y-codemirror.next (v14 binding unstable; use v13)
- Hocuspocus Throttle extension: https://tiptap.dev/docs/hocuspocus/server/extensions/throttle (per-IP
  connection-attempt throttle + ban, not message rate)
- Hocuspocus Redis extension: https://tiptap.dev/docs/hocuspocus/server/extensions/redis (fan-out makes
  all instances process all messages)
