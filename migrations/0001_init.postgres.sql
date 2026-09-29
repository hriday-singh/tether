-- Migration 0001: Initial Schema (PostgreSQL 16+)
-- Target: Multi-node production deployment on AWS RDS

CREATE TABLE IF NOT EXISTS rooms (
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
  create_key         uuid NULL UNIQUE                  -- Idempotency-Key
);

CREATE TABLE IF NOT EXISTS room_updates (
  id          bigserial PRIMARY KEY,
  room_id     text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  update_data bytea NOT NULL,                          -- merged Yjs update (one flush)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_updates_room_id_id_idx ON room_updates (room_id, id);

CREATE TABLE IF NOT EXISTS room_members (
  room_id         text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL,
  display_name    text NOT NULL,
  color_index     smallint NOT NULL,
  first_joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  banned_at       timestamptz NULL,
  PRIMARY KEY (room_id, member_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id              bigserial PRIMARY KEY,
  room_id         text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq             integer NOT NULL,                    -- per-room, gapless, commit order
  type            text NOT NULL,
  actor_member_id uuid NULL,                           -- null = system
  actor_name      text NULL,                           -- denormalized: names can change
  payload         jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_room_id_seq_idx ON audit_events (room_id, seq);
