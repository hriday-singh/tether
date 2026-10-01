# 05: Rooms, Security & Roles

## Rooms

- **Room ID:** user-chosen slug `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$` (3-32 chars), or generated
  (`adjective-noun-4digits`) if left blank. Unique. Case-insensitive (stored lowercase).
- **Persistent:** a room and its document survive after everyone leaves. Only an explicit delete
  (week-3 stretch: expiry job) removes it.
- **Epoch:** UUID set at creation. It scopes local IndexedDB copies (see [03](03-sync-engine.md#44-surviving-a-tab-refresh-while-offline)).
- **Settings:** `language`, `locked`, passcode (hash + version).

## REST endpoints

All bodies are Zod-validated and all errors use one shape: `{ error: { code, message, details? } }`.

| Method | Path | Body | Returns | Rate limit |
|--------|------|------|---------|------------|
| POST | `/api/rooms` | `{ roomId?, passcode?, name, language? }` + header `Idempotency-Key` | `201 { room, token, memberId }`. Creator becomes host | 10/min/IP |
| GET | `/api/rooms/:id` | - | `{ id, hasPasscode, locked, memberCount }` (for the join gate) | 60/min/IP |
| POST | `/api/rooms/:id/join` | `{ name, passcode?, memberId? }` | `200 { room, token, memberId }` | **5/min per IP+room** (brute force) |
| GET | `/api/rooms/:id/events?before=<seq>` or `?after=<seq>`, `&limit=50` | - (token in `Authorization: Bearer`) | `{ items, nextBefore \| nextAfter }`, max limit 100. `after` returns ascending (gap-fill) | 60/min/token (plus 120/min/IP backstop) |
| GET | `/api/rooms/:id/admission` | - (Bearer token) | `{ status: ok \| reauth \| banned \| locked \| full \| draining }`, 404 if the room is gone. Runs admission checks 3-8 without opening anything | 30/min/IP |
| GET | `/health/live`, `/health/ready`, `/metrics` | - | liveness / readiness (DB + buffer) / Prometheus | internal |

`memberId` on join: the client re-sends its previous `memberId` (from localStorage) so a returning
browser keeps the same identity and color. Reclaiming an existing identity requires a valid room session token in `Authorization: Bearer <token>` where `claims.sub === memberId`, preventing unauthorized identity hijacking. Otherwise, the server generates a fresh UUID. If a new member attempts to join a room at maximum capacity (`MAX_MEMBERS_PER_ROOM`), the server returns `403` with code `full`. Banned member IDs get 403 (`banned`).

**Create is retry-safe.** The client sends `Idempotency-Key: <uuid>`, one per form submit. If a create
succeeds but the response is lost and the client retries, the server finds the key on the room row and
returns `200` with the same room, creator `memberId` and a fresh token, instead of a confusing `409`.
A custom ID taken by someone else returns `409 room_taken` with `details.suggestion` (ID + 4-digit
suffix, checked free). The submit button is disabled while the request is in flight.

**Display names** don't need to be unique. If two active members share a name (case-insensitive),
roster and cursor labels add `(2)`, and colors always differ. Identity is `memberId`, never the name.

OpenAPI spec generated from the Zod schemas (`/docs/openapi.json`) per stack rules.

## Credentials & tokens

- **Passcode:** 4-64 chars. Stored as `scrypt(N=2^15, r=8, p=1, 16-byte salt, 32-byte key)`, compared with
  `timingSafeEqual`. Never logged (pino redaction on `passcode`, `token`, `authorization`,
  `sec-websocket-protocol`).
- **Room session token:** JWT HS256 via `jose`, secret from `JWT_SECRET` (≥ 32 bytes, validated at boot).

```json
{ "sub": "<memberId>", "aud": "room:<roomId>", "name": "<displayName>",
  "pv": <passcodeVersion>, "ep": "<roomEpoch>", "iat": ..., "exp": iat + 24h }
```

- Verified at WebSocket upgrade: signature, `exp`, `aud`, `ep` = current epoch, `pv` = current
  passcode version (if the room has a passcode), member not banned.
- **Sliding refresh:** while connected, the server pushes a fresh token hourly (`token` control
  message). Active users never expire. A user away > 24 h goes back to the join gate.
- **Passcode change:** bumps `pv`. Connected members keep working, but anyone reconnecting with an old
  token must re-enter the new passcode. This is what "change passcode to remove access" means.

## Admission checklist (enforced in order, at upgrade)

1. `Origin` ∈ `ALLOWED_ORIGINS` (prevents cross-site WebSocket hijacking)
2. Subprotocol `collab.v1` present, token present
3. Token valid (sig, exp, aud, epoch, pv)
4. Room exists
5. Member not banned
6. Room not locked, **or** member already has a roster record in this room
7. Caps: per-IP connections, room members
8. Server not draining, persistence buffer not full

Only after all eight pass does `wss.handleUpgrade` run. The spec's "credentials validated prior to
admitting" is satisfied literally: no socket exists for a rejected client.

## Presence identity binding

Awareness is unauthenticated by design. Per y-protocols: "a malicious peer can claim arbitrary cursor
or presence data. Authoritative identity MUST be enforced at a higher layer". Our layer:

- The first awareness entry from a connection claims its Yjs `clientID` for that connection.
  A connection may own **one** clientID. Entries for other clientIDs, or for a clientID owned by
  another connection, are dropped (entry-level) and counted. More than 10 dropped entries means `4009`.
- `state.memberId` must equal the connection's authenticated member. Otherwise the entry is dropped.
- State passes Zod (shape in [04](04-protocol.md#awareness-state-shape-per-yjs-client)) and the 2 KB cap.
- Names/colors come from the server roster, never from awareness.

## Host election

State per room (in memory, single process):

```
members: Map<memberId, { name, colorIndex, joinedAt, connections: Set<Conn>, graceTimer? }>
hostId: memberId | null
```

- `joinedAt` = when the member became active in this room session. It is **kept** across reconnects
  that land within the grace window (a Wi-Fi blip does not demote you in seniority) and reset
  otherwise.
- **Election function (pure):** `electHost(members) = argmin(joinedAt, tiebreak memberId)` over members
  that are active or inside their grace window.

| Event | Result |
|-------|--------|
| Room created | Creator is host (`reason: creator`) |
| Host sends `leave` | Instant re-election among others (`handover-leave`) |
| Host's last connection drops abruptly | Host shown as `reconnecting`. After `HOST_GRACE_MS` (5 s) without reconnect: removed, re-election (`handover-timeout`) |
| Host reconnects inside grace | Keeps host, no event |
| Host kicked? | Impossible: host can't kick self; manual transfer first |
| `host.transfer` | Target must be active (`manual`) |
| Room empties | `hostId = null`. First person to join later becomes host |
| Creator rejoins after handover | **Does not** reclaim host. Current host may transfer back manually. Avoids flapping |
| Two members with same `joinedAt` ms | Tiebreak by `memberId` string, deterministic |

Host-only commands are checked against the **current** `hostId` at the moment of handling. A command
racing a handover gets `error forbidden`, never a partial effect.
Repeated commands are no-ops that still return `ok` (see [04](04-protocol.md#control-messages-json-text-frames)).

## Kick & ban

`host.kick(memberId)`: insert `room_members.banned_at`, close all that member's sockets with `4003`,
audit event. Ban applies to that member ID. A kicked user could clear storage to get a new ID, which is
why the host also gets `host.passcode` (rotate) and `host.lock`. We document this limit honestly: guest
identity cannot give stronger guarantees without accounts.

The kicked client shows how many changes never reached the server and offers **Copy my version** before
it clears its local copy (see [03](03-sync-engine.md#7-edge-cases)).

## Threat list

| Threat | Mitigation |
|--------|-----------|
| Passcode brute force | 5/min per IP+room on join, scrypt cost |
| Token theft via logs | Token in subprotocol header, log redaction |
| Cross-site WebSocket hijack | Origin allow-list at upgrade |
| Presence spoofing | Identity binding above |
| Socket flooding | Outbound throttle + inbound flood guard + frame cap |
| Memory exhaustion | Frame/doc/awareness caps, slow-consumer close, bounded persistence buffer, connection caps |
| XSS via names / feed | Names 1-32 chars, control chars stripped, rendered as text only (React escaping), strict CSP |
| XSS via Markdown preview | DOMPurify HTML sanitization in the parent origin; preview iframes use opaque origin (`null`) without `allow-same-origin` |
| Malformed binary | Decoder in try/catch, `4009`, never crashes the process |
| Non-host admin actions | Server-side host check per command |
| SQL injection | Parameterized queries only |
