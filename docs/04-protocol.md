# 04 — Wire Protocol (`collab.v1`)

One WebSocket per client per room. **Binary frames** carry Yjs data. **Text frames** carry JSON
control messages validated with Zod on both ends. Codec and schemas live in `packages/shared/protocol`,
and all three consumers (web, server, chaos harness) import that same code.

## Connection

```
GET /ws/rooms/:roomId
Sec-WebSocket-Protocol: collab.v1, <roomSessionToken>
Origin: <must be in ALLOWED_ORIGINS>
```

- The token travels in the subprotocol header, not the query string, so it never shows up in proxy/access logs.
  The server answers with `Sec-WebSocket-Protocol: collab.v1` only.
- Every check runs in the HTTP `upgrade` handler **before** `handleUpgrade`. Failure means a plain HTTP
  response and no socket:

| HTTP | Reason |
|------|--------|
| 400 | Bad room ID format / missing subprotocol |
| 401 | Token missing, bad signature, expired, `aud` ≠ roomId |
| 403 | Origin not allowed, member banned (kicked), stale `passcodeVersion`, room locked and member never admitted |
| 404 | Room does not exist |
| 429 | Per-IP connection cap (20) or room member cap (32) |
| 503 | Server draining or persistence buffer full |

## Binary frames

Encoding uses `lib0` varints (`varUint`, `varBuffer`), as in
[y-protocols PROTOCOL.md](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md).
We use Yjs/y-protocols primitives inside **our own envelope**, because we need a sequence number for
acks and one combined doc+awareness frame per throttle tick.

```
frame := varUint(kind) • body
```

| kind | Name | Direction | Body |
|------|------|-----------|------|
| 0 | `SYNC_STEP1` | both | `varBuffer(stateVector)` |
| 1 | `SYNC_STEP2` | both | `varUint(seq) • varBuffer(update)`, where seq = 0 from server |
| 2 | `UPDATE` | both | `varUint(seq) • varBuffer(docUpdate) • varBuffer(awarenessUpdate)`: either buffer may be empty; seq = 0 from server |

- `stateVector` = `Y.encodeStateVector(doc)`
- `update` in step 2 = `Y.encodeStateAsUpdate(doc, remoteStateVector)`
- `awarenessUpdate` = `awarenessProtocol.encodeAwarenessUpdate(awareness, clientIDs)`

**Frame rules enforced by the server:**
- First client frame must be `SYNC_STEP1`. Client `SYNC_STEP1` once per connection, client `SYNC_STEP2`
  once per connection and only after the server's step 1. Violation: `4009`.
- `UPDATE` before handshake completion: `4009`.
- Frame > 512 KB: `4009`.
- Client `seq` strictly increasing per connection (starts at 1). Violation: `4009`.
- Awareness entries: see identity binding in [05](05-rooms-security-roles.md#presence-identity-binding).

## Control messages (JSON text frames)

Every message has a `t` discriminator. Unknown `t` or failed Zod parse closes with `4009`.

### Client → Server

| `t` | Fields | Who | Effect |
|-----|--------|-----|--------|
| `ping` | `id: number, ts: number` | anyone | Server replies `pong` immediately |
| `leave` | — | anyone | Clean leave: instant host handover if host, then server closes `1000` |
| `host.kick` | `memberId` | host | Close target's sockets `4003`, ban member ID for this room |
| `host.lock` | `locked: boolean` | host | Locked rooms admit no new members (existing members may reconnect) |
| `host.passcode` | `passcode: string \| null` | host | Set/change/clear. Bumps `passcodeVersion`. Connected members keep their session |
| `host.transfer` | `memberId` | host | Manual handover to an active member |
| `room.language` | `language: LanguageId` | host | Change syntax mode for everyone |
| `verify.mismatch` | `sv, hash` | anyone | Client saw equal state vectors but a different hash (P1). Metric + log, then client resets from server |
| `demo.storm` | `bots: 1–8, seconds: 1–60, faults: boolean` | host, `DEMO_MODE` only | Start a bot storm (P2, see [08](08-testing-and-verification.md#bot-storm-p2-demo-mode)) |
| `chat.send` | `rid: uuid, text: string` (trimmed, 1–`CHAT_MAX_CHARS`) | anyone | Store and broadcast `chat.msg`, then `ok {rid}`. `rid` is the idempotency key: a resend returns the stored message to the sender only. Own bucket per connection (`CHAT_RATE_PER_SEC`/`CHAT_BURST`); over it gets `error {rid, code:"rate_limited"}`, no disconnect ([ADR-017](11-decisions.md#adr-017-text-chat-in-voice-chat-out-amends-adr-015)) |

Host-only messages from non-hosts get `error {code:"forbidden"}` (no disconnect: a race with host
handover is legit) plus an audit entry.

**Command ids and idempotence.** Every `host.*`, `room.language` and `demo.storm` message carries
`rid` (client UUID). The server answers `ok {rid}` or `error {rid, code}`, so the UI can show a pending
state and settle it. Commands are idempotent by target state: kicking an already-banned member,
locking a locked room, setting the current language, or setting the passcode that already matches the
stored hash returns `ok` and writes no audit event. A double click on a laggy connection has exactly one
effect.

### Server → Client

| `t` | Fields | When |
|-----|--------|------|
| `welcome` | `self: Member, members: Member[], hostId, room: {id, language, locked, hasPasscode, epoch}, token, eventSeq, chatSeq` | After handshake. `eventSeq` / `chatSeq` = latest committed feed / chat seq |
| `pong` | `id, ts, serverQueueMs` | Reply to ping |
| `ack` | `seq` | After the update containing `seq` is committed to the database (SQLite / PostgreSQL) |
| `member.joined` / `member.left` / `member.status` | `member` / `memberId, reason` / `memberId, status` | Roster changes. `reason`: `leave \| timeout \| kicked` |
| `host.changed` | `hostId, reason: "creator" \| "handover-leave" \| "handover-timeout" \| "manual"` | Host election result |
| `room.updated` | partial room settings | lock / passcode / language change |
| `event` | `AuditEvent` (with per-room `seq`) | Live feed item, sent only after its row commits (see below) |
| `throttled` | `windowMs` | Sender exceeded 5/s; updates are being batched (not lost) |
| `token` | `token` | Sliding token refresh (every hour while connected) |
| `error` | `code, message, rid?` | Non-fatal error. `rid` set when answering a command |
| `ok` | `rid` | Command applied, or already in that state |
| `checksum` | `sv, hash` | Room quiet after a change (P1, see [03](03-sync-engine.md#47-verified-in-sync-p1)) |
| `chat.msg` | `message: {id, roomId, seq, clientMsgId, memberId, name, colorIndex, text, createdAt}` | Chat message committed. Sent to everyone, sender included |

`Member = { id, name, colorIndex, joinedAt, status: "active" | "idle" | "away" | "reconnecting", isHost, isBot }`

### Activity feed delivery (no duplicates, no gaps)

Feed events are control messages, not CRDT updates, so they need their own exactly-once rule:

1. Every audit event has a per-room `seq` (1, 2, 3, … with no holes). The room owner assigns it in commit
   order and pushes the `event` only after the row commits (see [06](06-data-model.md#access-patterns)).
2. The client stores events in one map keyed by `seq` and renders them sorted. An event that arrives
   through both the live push and a REST page is stored once.
3. On every `welcome`, if the client's highest seq < `eventSeq`, it fetches
   `GET /events?after=<seq>` (ascending, 100 per page) until caught up. Live events that arrive during
   the fetch go into the same map. A gap larger than `FEED_GAP_FILL_MAX` drops the local feed and loads
   the newest page. Older history stays reachable by scrolling.
4. A live event with `seq > highest + 1` also triggers the same gap-fill.

Chat uses the same rules with its own `seq` counter: `welcome.chatSeq`, live `chat.msg`, and
`GET /api/rooms/:id/chat?before|after&limit` (same page shape as `/events`, bearer room token).
Chat is never written into the Yjs doc and never creates audit events.

## Awareness state shape (per Yjs client)

Validated with Zod on the server before re-broadcast:

```ts
{
  memberId: string,              // must equal the connection's authenticated member
  cursor: { anchor: RelPos, head: RelPos } | null,   // written by y-codemirror.next
  highlight: { from: RelPos, to: RelPos } | null,    // line highlight, relative positions
  typing: boolean,               // true if local edit in last 1.5 s
  status: "active" | "idle" | "away"                  // idle: no input 60 s, away: tab hidden
}
```

Name and color are **not** in awareness. The UI resolves them from the server roster by `memberId`,
so nobody can impersonate a name through awareness. Awareness state JSON is capped at 2 KB per client.

## Close codes

| Code | Meaning | Client action |
|------|---------|---------------|
| 1000 | Normal (after `leave`) | Don't reconnect |
| 1001 | Going away | Reconnect with backoff |
| 1006 | Abnormal (no close frame) | Reconnect with backoff |
| 1012 | Server restart | Reconnect with backoff |
| 4003 | Kicked | Don't reconnect; clear local copy; show message |
| 4004 | Room deleted | Don't reconnect; clear local copy |
| 4008 | Slow consumer | Reconnect immediately (handshake resyncs) |
| 4009 | Protocol violation | Reconnect once; second violation within 60 s: stop and show error |
| 4013 | Doc too large / reset | Reset local doc, reconnect |
| 4029 | Flood | Reconnect after `retryAfter` = 10 s |

Upgrade-time rejections (401/403/404/423/503) reach the browser only as `1006`. The client tells them
apart with `GET /api/rooms/:id/admission` (see [03](03-sync-engine.md#42-backoff)) and never loops on a
permanent rejection.

## Limits (single source: `packages/shared/src/constants.ts`)

| Constant | Value |
|----------|-------|
| `THROTTLE_RATE_PER_SEC` / `THROTTLE_BURST` | 5 / 5 |
| `CLIENT_BATCH_WINDOW_MS` | 200 |
| `FLOOD_FRAMES_PER_SEC` / `FLOOD_WINDOW_SEC` | 30 / 3 |
| `MAX_FRAME_BYTES` | 512 KB |
| `MAX_DOC_BYTES` | 2 MB |
| `MAX_AWARENESS_STATE_BYTES` | 2 KB |
| `SLOW_CONSUMER_BYTES` | 4 MB |
| `MAX_MEMBERS_PER_ROOM` / `MAX_CONN_PER_IP` | 32 / 20 |
| `CLIENT_PING_MS` / `CLIENT_DEAD_MS` | 5 000 / 12 000 |
| `SERVER_PING_MS` | 15 000 |
| `HOST_GRACE_MS` | 5 000 (env `HOST_GRACE_MS`) |
| `PERSIST_FLUSH_MS` / `COMPACT_AFTER_ROWS` | 250 / 500 |
| `ROOM_UNLOAD_IDLE_MS` | 30 000 |
| `WAKE_PROBE_MS` | 2 000 |
| `CHECKSUM_QUIET_MS` | 500 |
| `FEED_GAP_FILL_MAX` | 500 |
| `STORM_MAX_BOTS` / `STORM_MAX_SECONDS` | 8 / 60 |

## Versioning

Subprotocol name carries the version (`collab.v1`). A breaking change ships as `collab.v2` and the
server accepts both during a transition. Unknown versions are rejected at upgrade (400).
