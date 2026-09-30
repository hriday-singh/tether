-- Migration 0002: Text chat (ADR-017)
-- Adds chat_messages with its own per-room gapless seq (separate from audit_events.seq).
-- Additive only. Safe to apply on a live database. Rollback: DROP TABLE chat_messages;
CREATE TABLE IF NOT EXISTS chat_messages (
  id            bigserial PRIMARY KEY,
  room_id       text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq           integer NOT NULL,                    -- per-room, gapless, commit order
  client_msg_id uuid NOT NULL,                       -- chat.send rid; resend after reconnect is a no-op
  member_id     text NOT NULL,
  display_name  text NOT NULL,                       -- denormalized: names can change, members can leave
  color_index   integer NOT NULL,
  body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Pagination (before/after seq) and gapless seq guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_room_id_seq_idx ON chat_messages (room_id, seq);
-- Idempotent resend lookup.
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_room_id_client_msg_id_idx ON chat_messages (room_id, client_msg_id);
