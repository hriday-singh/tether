# 06: Data Model (SQLite)

## Strategy: SQLite only ([ADR-020](11-decisions.md#adr-020-sqlite-only-postgres-removed))

To minimize setup complexity and eliminate external service dependencies during prototyping, local development, and single-instance deployments, the server **only supports SQLite** (via Node 22 built-in `node:sqlite` with Write-Ahead Logging `WAL` mode). `DATABASE_DRIVER` accepts only `sqlite`; any other value stops the server at boot.

A 1:1 **PostgreSQL** schema is kept below and in `migrations/*.postgres.sql` as a reference for a future driver. Nothing in the server reads it. Adding Postgres is not a drop-in adapter: the repositories (`apps/server/src/repo/`) use `node:sqlite`'s synchronous API, so every repo method and the roughly 15 files that call them would have to become async first. See [09 › Scale path](09-operations.md#scale-path-documented-not-built-in-v1).

Migrations are written as SQL files in `migrations/` and **applied by the user, never by Claude or CI**.

---

## 1. Active Schema: SQLite (POC / Local Dev / Single-Node)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE rooms (
  id                 TEXT PRIMARY KEY,                 -- lowercase slug
  epoch              TEXT NOT NULL,                    -- UUID string
  passcode_hash      TEXT NULL,                        -- scrypt: "scrypt$N$r$p$saltB64$keyB64"
  passcode_version   INTEGER NOT NULL DEFAULT 0,
  language           TEXT NOT NULL DEFAULT 'javascript',
  locked             INTEGER NOT NULL DEFAULT 0,       -- 0 = false, 1 = true
  snapshot           BLOB NULL,                        -- Y.encodeStateAsUpdate(doc)
  snapshot_at        TEXT NULL,                        -- ISO 8601
  created_by         TEXT NOT NULL,                    -- creator memberId UUID
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_active_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  create_key         TEXT NULL UNIQUE                  -- Idempotency-Key
);

CREATE TABLE room_updates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  update_data BLOB NOT NULL,                           -- merged binary Yjs update (one flush)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX room_updates_room_id_id_idx ON room_updates (room_id, id);   -- load + compaction range

CREATE TABLE room_members (
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id       TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  color_index     INTEGER NOT NULL,
  first_joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  banned_at       TEXT NULL,
  PRIMARY KEY (room_id, member_id)
);

CREATE TABLE audit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,                    -- per-room, gapless, commit order
  type            TEXT NOT NULL,
  actor_member_id TEXT NULL,                           -- null = system
  actor_name      TEXT NULL,                           -- denormalized: names can change
  payload         TEXT NOT NULL DEFAULT '{}',          -- JSON string
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX audit_events_room_id_seq_idx ON audit_events (room_id, seq);
```

---

## 2. Reference Schema: PostgreSQL (not wired up)

```sql
CREATE TABLE rooms (
  id                 text PRIMARY KEY,                 -- lowercase slug
  epoch              uuid NOT NULL DEFAULT gen_random_uuid(),
  passcode_hash      text NULL,                        -- scrypt: "scrypt$N$r$p$saltB64$keyB64"
  passcode_version   integer NOT NULL DEFAULT 0,
  language           text NOT NULL DEFAULT 'javascript',
  locked             boolean NOT NULL DEFAULT false,
  snapshot           bytea NULL,                       -- Y.encodeStateAsUpdate(doc)
  snapshot_at        timestamptz NULL,
  created_by         uuid NOT NULL,                    -- creator memberId
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_active_at     timestamptz NOT NULL DEFAULT now(),
  create_key         uuid NULL UNIQUE                  -- Idempotency-Key of the create request
);

CREATE TABLE room_updates (
  id         bigserial PRIMARY KEY,
  room_id    text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  update_data bytea NOT NULL,                          -- merged Yjs update (one flush)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_updates_room_id_id_idx ON room_updates (room_id, id);

CREATE TABLE room_members (
  room_id         text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL,
  display_name    text NOT NULL,
  color_index     smallint NOT NULL,
  first_joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  banned_at       timestamptz NULL,
  PRIMARY KEY (room_id, member_id)
);

CREATE TABLE audit_events (
  id              bigserial PRIMARY KEY,
  room_id         text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq             integer NOT NULL,                    -- per-room, gapless, commit order
  type            text NOT NULL,
  actor_member_id uuid NULL,                           -- null = system
  actor_name      text NULL,                           -- denormalized: names can change
  payload         jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX audit_events_room_id_seq_idx ON audit_events (room_id, seq);
```

| Type Concept | SQLite (active) | PostgreSQL (reference) |
|---|---|---|
| Binary Yjs payload | `BLOB` | `bytea` |
| JSON Audit payload | `TEXT` (parsed in app) | `jsonb` |
| Unique identifiers | `TEXT` (UUID v4) | `uuid` (`gen_random_uuid()`) |
| Timestamps | `TEXT` (ISO 8601 UTC) | `timestamptz` |
| Auto-increment ID | `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigserial PRIMARY KEY` |

## Chat messages ([ADR-017](11-decisions.md#adr-017-text-chat-in-voice-chat-out-amends-adr-015), [ADR-018](11-decisions.md#adr-018-chat-code-references-via-yjs-relative-positions))

Migration `migrations/0002_chat.{sqlite,postgres}.sql` & `migrations/0003_chat_refs_room_expiry.{sqlite,postgres}.sql` (generated, apply manually; the `.postgres.sql` files are reference only). Table `chat_messages`:
`id`, `room_id` (FK, cascade), `seq` (per-room gapless, own counter), `client_msg_id` (the `chat.send`
`rid`), `member_id`, `display_name` + `color_index` (denormalized snapshot), `body` (1-2000 chars),
`code_ref` (JSON string or null for quoted code reference: `{from, to, line, endLine, snippet}`),
`created_at`. Indexes: unique `(room_id, seq)` for paging, unique `(room_id, client_msg_id)` for
idempotent resends.

## Audit event types

| type | payload | Emitted when |
|------|---------|--------------|
| `room.created` | `{ language, hasPasscode }` | Room creation |
| `member.joined` | `{}` | Member becomes active (not on reconnect within grace) |
| `member.left` | `{ reason: leave\|timeout\|kicked }` | Member removed |
| `host.changed` | `{ from, to, toName, reason }` | Election result (`toName` denormalized for human readability) |
| `room.locked` / `room.unlocked` | `{}` | Host |
| `room.passcode` | `{ action: set\|changed\|cleared }` | Host (never the passcode) |
| `room.language` | `{ from, to }` | Host |
| `edit.summary` | `{ inserted, deleted, lines: [from, to] }` | Coalesced per member per 5 s of editing |
| `throttle.applied` | `{ windowMs }` | Sender exceeded 5/s (max 1 per member per 10 s) |
| `security.flood` / `security.protocol` | `{ code }` | Socket closed for abuse |
| `demo.storm` | `{ bots, seconds, faults }` | Host started a bot storm (demo mode) |

**Edit summaries:** the server observes `Y.Text` deltas per transaction. The transaction origin is the
source connection, so attribution is authoritative. It accumulates inserted/deleted counts and the
touched line range per member and emits one event after 5 s without edits from that member (or every
30 s during continuous editing). The line range is computed at emit time. This keeps the feed readable
instead of one row per keystroke.

## Access patterns

| Query | Index |
|-------|-------|
| Load room: snapshot + tail `WHERE room_id=$1 ORDER BY id` | `room_updates_room_id_id_idx` |
| Compaction delete `WHERE room_id=$1 AND id <= $2` | same |
| Feed page `WHERE room_id=$1 AND seq < $before ORDER BY seq DESC LIMIT $n` | `audit_events_room_id_seq_idx` |
| Feed gap-fill `WHERE room_id=$1 AND seq > $after ORDER BY seq ASC LIMIT $n` | same |
| Next seq on room load `SELECT max(seq) WHERE room_id=$1` | same |
| Create retry `WHERE create_key=$1` | `rooms_create_key_key` (from `UNIQUE`) |
| Ban check `(room_id, member_id)` | PK |
| Expiry sweep `DELETE FROM rooms WHERE last_active_at < $1` | `rooms_last_active_at_idx` |

Audit writes are batched with the persistence flush (same 250 ms tick, separate insert) so they don't add
per-event round trips.

`seq` is assigned when the flush builds its insert. A failed flush keeps its rows **and their seqs** and
retries them, so seqs never skip or repeat. The unique index turns any bug here into a loud error
instead of a silent duplicate. Live `event` messages go out only after the insert commits.

## Retention

- `room_updates`: compacted continuously (see [03](03-sync-engine.md#5-persistence)).
- `rooms`: automated 24-hour idle sweep (`ROOM_EXPIRE_IDLE_MS = 24 * 60 * 60 * 1000`). Rooms with zero
  active connections whose `last_active_at` exceeds 24 hours are deleted by the background registry
  timer. All associated data (`room_updates`, `room_members`, `chat_messages`, `audit_events`) are
  purged via database foreign key cascading (`ON DELETE CASCADE`).
- `audit_events`: retained with the room lifecycle.
