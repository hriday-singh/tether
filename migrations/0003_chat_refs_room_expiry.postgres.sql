-- Migration 0003: chat code references + room expiry (see 0003_chat_refs_room_expiry.sqlite.sql)
-- Additive only. Safe to apply on a live database.
-- Rollback: DROP INDEX rooms_last_active_at_idx; ALTER TABLE chat_messages DROP COLUMN code_ref;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS code_ref jsonb NULL;
CREATE INDEX IF NOT EXISTS rooms_last_active_at_idx ON rooms (last_active_at);
