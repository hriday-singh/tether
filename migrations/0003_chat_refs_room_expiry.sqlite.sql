-- Migration 0003: chat code references + room expiry
-- 1. chat_messages.code_ref: optional JSON {from, to, line, endLine, snippet} for a quoted code range
--    (from/to are base64 Y.RelativePosition so the range follows later edits). NULL for plain messages.
-- 2. rooms_last_active_at_idx: the hourly expiry sweep deletes rooms idle > 24h
--    (DELETE FROM rooms WHERE last_active_at < ?); children go via ON DELETE CASCADE.
-- Additive only. Safe to apply on a live database.
-- Rollback: DROP INDEX rooms_last_active_at_idx; ALTER TABLE chat_messages DROP COLUMN code_ref;
ALTER TABLE chat_messages ADD COLUMN code_ref TEXT NULL;
CREATE INDEX IF NOT EXISTS rooms_last_active_at_idx ON rooms (last_active_at);
