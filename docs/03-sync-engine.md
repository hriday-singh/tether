# 03 — Sync Engine (the core)

This is the part that must be bulletproof. Every other doc bends to fit this one.

## 1. Foundation: why Yjs makes "zero loss" achievable

Yjs document updates are **commutative, associative and idempotent**: they can be applied in any
order, any number of times, and all peers converge once each has received every update
([Yjs docs: Document Updates](https://docs.yjs.dev/api/document-updates)). Three consequences drive
the whole design:

| Property | What it lets us do |
|----------|--------------------|
| Commutative + associative | Merge queued updates into one (`Y.mergeUpdates`) and send them later, so throttling never has to drop anything |
| Idempotent | Resend freely. Reconnects, retries and replaying the persistence log can never duplicate text |
| State vectors | A reconnecting client sends "what I have", the server answers with exactly "what you lack", and vice versa. One recovery path covers every failure |

**Design rule:** every failure mode (socket drop, slow consumer, server restart, protocol hiccup)
recovers through the **same path**: reconnect, then the state-vector handshake. We never write special
"repair" logic.

## 2. Invariants (tested, see [08](08-testing-and-verification.md))

- **I1 Convergence.** When the network is quiet, every connected client's `Y.Text` equals the server's, byte for byte.
- **I2 No loss.** Any insert that no peer deleted exists in the final document, including inserts made
  while offline, during throttling, or right before a crash of the client connection.
- **I3 No duplication.** No insert appears more than once.
- **I4 Throttle bound.** Peers receive ≤ 5 broadcast frames per second originating from any single connection.
- **I5 Server freshness.** The server's in-memory doc applies every accepted update immediately, so
  a new joiner always receives the latest state, even while that update's broadcast is still queued.
- **I6 Ack = durable.** A client considers a change saved only after the server acks it, and the server
  acks only after the change is committed to the database (SQLite).

**What "zero loss" does not mean:** two people typing in the same spot concurrently (or offline)
get both texts interleaved deterministically, which is standard CRDT behavior. We preserve every
character. We do not "resolve" intent. The README says this plainly.

## 3. Lossless throttling

Spec: throttle broadcast traffic from any connection sending rapid bursts (> 5 updates/s).
We throttle in three layers. Only the last one ever disconnects anyone.

### 3.1 Client batcher (cooperative)

Inside `SyncClient`:

- Local doc updates and local awareness changes go into one pending batch.
- **Leading edge:** if the last frame went out ≥ 200 ms ago, flush immediately. A lone keystroke goes
  out with zero added delay.
- Otherwise flush at `lastSentAt + 200 ms`. Doc updates merge with `Y.mergeUpdates`. Awareness keeps
  only the latest local state.
- One frame per flush carries both parts (see [04](04-protocol.md) `UPDATE` frame), so a well-behaved
  client sends at most 5 frames/s. The server throttle never triggers for honest clients.

### 3.2 Server outbound throttle (enforcement, lossless)

Per source connection, an `OutboundThrottle` with a token bucket (`rate = 5/s`, `burst = 5`):

```
on inbound UPDATE from S:
  apply doc part to room Y.Doc          (immediately, invariant I5)
  apply awareness part (after identity check, see 05)
  push doc part to S.pendingDoc; add changed clientIDs to S.pendingAwareness
  if S.bucket.take(now): flush(S)
  else if no timer: timer = at S.bucket.nextAvailableAt(now) → flush(S)
       and notify S once per 10 s: control {t:"throttled"} + audit event

flush(S):
  doc = mergeUpdates(S.pendingDoc)                     // lossless
  aw  = encodeAwarenessUpdate(awareness, S.pendingAwareness)  // latest state wins
  broadcast UPDATE(doc, aw) to every connection in room except S
```

Result: peers see at most 5 frames/s from any source, the text arrives complete (just batched), and
cursors skip intermediate positions, which is fine because cursors are ephemeral.

### 3.3 Inbound flood guard (abuse only)

A misbehaving client (modified JS, script) could still pump frames. A separate inbound bucket counts
all frames: over **30 frames/s sustained for 3 s**, or any frame larger than **512 KB**, closes the
socket with `4029` (flood) or `4009` (protocol). The client must wait `retryAfter` (10 s) before
reconnecting. The server logs an audit event. Content received before the close was already applied,
so nothing is lost. The client's unsent content comes back through the handshake on reconnect.

### 3.4 Slow consumers

If a peer's socket `bufferedAmount` exceeds **4 MB** (peer can't keep up), the server closes it with
`4008`. The peer reconnects and resyncs through the handshake. We never build per-peer infinite queues,
so server memory stays bounded.

## 4. Reconnect & offline

### 4.1 Liveness

| Side | Mechanism | Dead after |
|------|-----------|-----------|
| Client | JSON `ping` every 5 s (and on tab becoming visible); any inbound frame counts as life | 12 s silence: force close, reconnect |
| Server | WebSocket protocol ping every 15 s | missed pong by next tick (≤ 30 s): `terminate()` |

Half-open TCP (laptop lid closed, Wi-Fi switch) gets detected by these timers and not by waiting on the OS.

**Wake-up fast path.** Browsers pause timers in background tabs and while a laptop sleeps, so the 12 s
timer can't be trusted after a wake. On `visibilitychange` (visible), `focus`, `pageshow` and `online`
the client sends a `ping` at once. No `pong` within `WAKE_PROBE_MS` (2 s) means: force close and
reconnect now, with no backoff delay. The browser `offline` event switches the status pill to Offline
right away instead of waiting for the timer.

### 4.2 Backoff

`delay = random(0, min(10 s, 250 ms × 2^attempt))` (full jitter, avoids thundering herd after a server
restart). Attempt counter resets on `welcome`. Immediate retry on the browser `online` event. Close
codes decide whether to retry at all (table in [04](04-protocol.md#close-codes)).

**Rejected upgrades look like network failures.** Browsers hide the HTTP status of a refused WebSocket
upgrade: the client only sees close `1006`. So when an attempt closes before `welcome` while
`navigator.onLine` is true, the client calls `GET /api/rooms/:id/admission` (see
[05](05-rooms-security-roles.md#rest-endpoints)). `ok` means a real network problem, so it keeps
backing off. Any other answer stops the loop: `reauth` (passcode changed or token expired) goes to the
join gate **with the local copy kept**, `banned` / `404` show a message and clear it, `locked` / `full` /
`draining` show a message and retry later.

### 4.3 The handshake is the recovery

The `Y.Doc` object lives for the whole page session. It is **not** recreated on reconnect. On every
(re)connect:

1. Client → `SYNC_STEP1(clientStateVector)`
2. Server → `SYNC_STEP2(diff the client lacks)` then `SYNC_STEP1(serverStateVector)`
3. Client → `SYNC_STEP2(diff the server lacks)`. This carries all offline edits. The server applies it
   and routes it through the source's outbound throttle to the other peers.
4. Server → control `welcome` (roster, host, room settings, refreshed token).

A connection joins the broadcast set only after step 2 is sent, so it never receives an update before
its baseline.

### 4.4 Surviving a tab refresh while offline

`y-indexeddb` persists the local `Y.Doc` under key `collab:<roomId>:<roomEpoch>`. On page load we
restore from IndexedDB **before** connecting, so step 3 includes edits typed before the refresh.
`roomEpoch` is a UUID set when the room is created. If a room gets deleted and re-created under the same
ID, old local data can't leak into it. The local copy is cleared on "Leave & clear", on kick, and on
`4013` (doc reset).

### 4.5 Pending-changes indicator

Each client `UPDATE` carries a sequence number. The server acks `{t:"ack", seq}` after the persistence
flush commits (I6). The UI shows:

- `Saved`: all seqs acked
- `Saving… (n)`: unacked frames in flight
- `Offline, n unsent changes, kept on this device`: disconnected with local changes

After a reconnect, the client's `SYNC_STEP2` gets its own seq, so pending state resolves correctly without
tracking which old seqs got lost.

### 4.6 Presence on disconnect

When a connection closes, the server removes its awareness clientIDs (sets state `null`) and
broadcasts immediately (system-originated, not throttled). The member stays "reconnecting" in the
roster for the host grace window, then leaves. See [05](05-rooms-security-roles.md#host-election).
Drops that recover within the grace window write no `member.left` / `member.joined` audit events and
cause no host change, so flaky Wi-Fi doesn't spam the feed. The roster row is dimmed while reconnecting.

### 4.7 Verified in sync (P1)

After a change, once the room has been quiet for `CHECKSUM_QUIET_MS` (500 ms), the server sends
`{t:"checksum", sv, hash}` to every connection. `sv` = base64 `Y.encodeStateVector(doc)`,
`hash` = first 16 bytes (hex) of SHA-256 of the text. At most one checksum per quiet period, docs
are ≤ 2 MB, so the cost is small.

Client:

1. Decode both state vectors and compare them **as maps**. Byte comparison is wrong because the encoded
   order of client IDs depends on the order updates were integrated.
2. Not equal: edits are still in flight one way or the other. Ignore the checksum; badge says Syncing.
3. Equal: hash the local text with `crypto.subtle`. Match: badge says Verified ("checked Ns ago").
4. Equal state vectors but different hashes means a real divergence bug. Send `verify.mismatch`
   (metric + log), then replace the local doc with the server's full state. Nothing is lost: equal
   state vectors prove the server already holds every local edit.

The badge never shows Verified while pending changes > 0 or while offline.

## 5. Persistence

```
rooms.snapshot (bytea)       compacted full state
room_updates (bytea rows)    append-only tail since last snapshot
```

- **Flush:** per room, every 250 ms (or at 64 queued updates): merge buffer → one `INSERT` into
  `room_updates`. After commit, send acks for every seq included.
- **Load:** apply `snapshot`, then every `room_updates` row ordered by id. Idempotence makes overlap harmless.
- **Compaction:** when the tail > 500 rows or the room unloads: in one transaction, write
  `encodeStateAsUpdate(doc)` to `rooms.snapshot` and delete tail rows with `id <= maxIdAtStart`.
  The in-memory doc is a superset of the log, so this is safe.
- **Unload:** 30 s after the last connection leaves: flush, compact, destroy the in-memory doc.
- **DB outage:** flush retries with backoff (cap 30 s). The room keeps working in memory, acks are
  withheld (clients show "Saving…"), and `/health/ready` reports degraded. The buffer is bounded
  (50 MB total). Past that, the server stops admitting new connections (503) instead of risking memory.
- **Crash semantics:** acked means in durable database storage (SQLite). Unacked edits still live in the clients (memory +
  IndexedDB) and come back through the handshake after restart. Only a simultaneous server crash **and**
  loss of every client that held the edit can lose it. The README states this plainly.

## 6. Latency

### Budget (one edit, peer to peer)

| Stage | Cost |
|-------|------|
| CodeMirror → Y.Text | < 1 ms |
| Client batcher | 0 ms (leading edge) … 200 ms (during bursts) |
| Network | RTT / 2 |
| Server apply + persistence buffer | < 1 ms |
| Outbound throttle | 0 ms … 200 ms (only if sender exceeds 5/s) |
| Peer apply + CodeMirror render | < 5 ms |

### What we measure

| Metric | Where | How |
|--------|-------|-----|
| RTT p50/p95 | In-app HUD | ping/pong over last 60 samples |
| Ack latency p50/p95 | In-app HUD | send → durable ack ("time to safe") |
| Server queue delay | `/metrics` histogram `collab_outbound_queue_delay_ms` | enqueue → flush |
| Edit propagation p50/p95/p99 | Bench harness | same-process clock, A inserts tagged marker, B observes |

The browser can't measure true cross-machine propagation (clocks differ), so the HUD shows RTT and ack
latency, and the README publishes bench propagation numbers.

## 7. Edge cases

| Case | Behavior |
|------|----------|
| Paste > 512 KB | Blocked client-side with toast. Server rejects oversized frames (`4009`) as defense |
| Doc > 2 MB encoded | Server rejects the update, closes `4013`. Client resets its local copy and resyncs. Room stays usable for deletes |
| Two tabs, same member | Two connections, one roster entry; member stays active while any connection lives |
| Server restart (deploy) | `SIGTERM`: stop accepting, flush + compact all rooms, close sockets with `1012`. Clients reconnect with jitter |
| Client clock skew | Irrelevant. All ordering is CRDT-based. Timestamps are server-assigned |
| Malformed binary frame | Decode inside try/catch, close `4009`, audit event, no crash |
| Undo | `Y.UndoManager` per client: undo only reverts your own changes |
| Room deleted while connected | Close `4004`. Client clears local copy and shows message |
| Kicked with unsent edits | Close `4003`. Screen says "Removed by host. N changes were not saved" and offers **Copy my version** (reads the in-memory `Y.Text`). IndexedDB copy cleared |
| Passcode changed while offline | Upgrade refused, admission probe returns `reauth`. Join gate asks for the new passcode. IndexedDB copy kept (same room + epoch), so offline edits merge after re-join |
| Laptop sleep / background tab | Wake fast path (4.1): reconnect ~2 s after wake, not 12 s+ |
| Flaky Wi-Fi (drops < 5 s) | Roster shows reconnecting, no feed noise, no host change (4.6) |

## Open questions

- None blocking. Tune the 200 ms window / 5 per s burst after the first bench run. The spec fixes the rate limit at 5/s.
