-- Migration 0001: Initial Schema (SQLite WAL mode)
-- Target: Local development, single-node deployments, and integration testing
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rooms (
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

CREATE TABLE IF NOT EXISTS room_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  update_data BLOB NOT NULL,                           -- merged binary Yjs update (one flush)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS room_updates_room_id_id_idx ON room_updates (room_id, id);

CREATE TABLE IF NOT EXISTS room_members (
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id       TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  color_index     INTEGER NOT NULL,
  first_joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  banned_at       TEXT NULL,
  PRIMARY KEY (room_id, member_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,                    -- per-room, gapless, commit order
  type            TEXT NOT NULL,
  actor_member_id TEXT NULL,                           -- null = system
  actor_name      TEXT NULL,                           -- denormalized: names can change
  payload         TEXT NOT NULL DEFAULT '{}',          -- JSON string
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_room_id_seq_idx ON audit_events (room_id, seq);
