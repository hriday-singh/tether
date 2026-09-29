# 06 — Data Model (SQLite & PostgreSQL)

## Strategy: SQLite for POC, PostgreSQL for Production Scale

To minimize setup complexity and eliminate external service dependencies during prototyping, local development, and single-instance deployments, the **active implementation uses SQLite** (via `better-sqlite3` with Write-Ahead Logging `WAL` mode).

For enterprise multi-node deployments requiring horizontal scaling, shared instances, or cloud-managed high availability (e.g. AWS RDS), the system defines a 1:1 mapped **PostgreSQL** schema. The repository layer (`apps/server/src/repo/`) strictly abstracts all queries so switching to PostgreSQL requires zero business-logic changes.

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

## 2. Production Scale Schema: PostgreSQL (AWS RDS / Multi-Instance)

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

| Type Concept | SQLite (POC) | PostgreSQL (Production Scale) |
|---|---|---|
| Binary Yjs payload | `BLOB` | `bytea` |
| JSON Audit payload | `TEXT` (parsed in app) | `jsonb` |
| Unique identifiers | `TEXT` (UUID v4) | `uuid` (`gen_random_uuid()`) |
| Timestamps | `TEXT` (ISO 8601 UTC) | `timestamptz` |
| Auto-increment ID | `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigserial PRIMARY KEY` |

## Audit event types

| type | payload | Emitted when |
|------|---------|--------------|
| `room.created` | `{ language, hasPasscode }` | Room creation |
| `member.joined` | `{}` | Member becomes active (not on reconnect within grace) |
| `member.left` | `{ reason: leave\|timeout\|kicked }` | Member removed |
| `host.changed` | `{ from, to, reason }` | Election result |
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

Audit writes are batched with the persistence flush (same 250 ms tick, separate insert) so they don't add
per-event round trips.

`seq` is assigned when the flush builds its insert. A failed flush keeps its rows **and their seqs** and
retries them, so seqs never skip or repeat. The unique index turns any bug here into a loud error
instead of a silent duplicate. Live `event` messages go out only after the insert commits.

## Retention

- `room_updates`: compacted continuously (see [03](03-sync-engine.md#5-persistence)).
- `audit_events`: kept. Week-3 stretch: delete events older than 90 days, and delete rooms inactive for
  30 days, via a scheduled job.
