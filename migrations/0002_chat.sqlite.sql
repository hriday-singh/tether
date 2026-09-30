-- Migration 0002: Text chat (ADR-017)
-- Adds chat_messages with its own per-room gapless seq (separate from audit_events.seq).
-- Additive only. Safe to apply on a live database. Rollback: DROP TABLE chat_messages;
CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,                    -- per-room, gapless, commit order
  client_msg_id TEXT NOT NULL,                       -- chat.send rid; resend after reconnect is a no-op
  member_id     TEXT NOT NULL,
  display_name  TEXT NOT NULL,                       -- denormalized: names can change, members can leave
  color_index   INTEGER NOT NULL,
  body          TEXT NOT NULL,                       -- plain text, 1..2000 chars (CHAT_MAX_CHARS)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Pagination (before/after seq) and gapless seq guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_room_id_seq_idx ON chat_messages (room_id, seq);
-- Idempotent resend lookup.
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_room_id_client_msg_id_idx ON chat_messages (room_id, client_msg_id);
