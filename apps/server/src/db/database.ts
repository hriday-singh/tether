import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface PreparedStatement<T = unknown> {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface DatabaseSession {
  exec(sql: string): void;
  prepare<T = unknown>(sql: string): PreparedStatement<T>;
  close(): void;
}

export class SqliteSession implements DatabaseSession {
  private db: DatabaseSync;

  constructor(filePath: string = ':memory:') {
    if (filePath !== ':memory:') {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(filePath);
    this.exec('PRAGMA foreign_keys = ON;');
    if (filePath !== ':memory:') {
      this.exec('PRAGMA journal_mode = WAL;');
    }
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public prepare<T = unknown>(sql: string): PreparedStatement<T> {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => stmt.run(...(params as (string | number | bigint | null | Uint8Array)[])),
      get: (...params: unknown[]) => stmt.get(...(params as (string | number | bigint | null | Uint8Array)[])) as T | undefined,
      all: (...params: unknown[]) => stmt.all(...(params as (string | number | bigint | null | Uint8Array)[])) as T[],
    };
  }

  public close(): void {
    this.db.close();
  }
}

export const SQLITE_INIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id                 TEXT PRIMARY KEY,
  epoch              TEXT NOT NULL,
  passcode_hash      TEXT NULL,
  passcode_version   INTEGER NOT NULL DEFAULT 0,
  language           TEXT NOT NULL DEFAULT 'javascript',
  locked             INTEGER NOT NULL DEFAULT 0,
  snapshot           BLOB NULL,
  snapshot_at        TEXT NULL,
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_active_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  create_key         TEXT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS room_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  update_data BLOB NOT NULL,
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
  seq             INTEGER NOT NULL,
  type            TEXT NOT NULL,
  actor_member_id TEXT NULL,
  actor_name      TEXT NULL,
  payload         TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_room_id_seq_idx ON audit_events (room_id, seq);

-- Mirrors migrations/0002_chat.sqlite.sql (ADR-017)
CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  client_msg_id TEXT NOT NULL,
  member_id     TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  color_index   INTEGER NOT NULL,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_room_id_seq_idx ON chat_messages (room_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_room_id_client_msg_id_idx ON chat_messages (room_id, client_msg_id);
`;

export function createDatabase(filePath = ':memory:'): DatabaseSession {
  const session = new SqliteSession(filePath);
  session.exec(SQLITE_INIT_SCHEMA);
  return session;
}
