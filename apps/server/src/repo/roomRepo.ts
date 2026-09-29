import { DatabaseSession } from '../db/database.js';

export interface RoomRow {
  id: string;
  epoch: string;
  passcode_hash: string | null;
  passcode_version: number;
  language: string;
  locked: number; // 0 or 1
  snapshot: Uint8Array | null;
  snapshot_at: string | null;
  created_by: string;
  created_at: string;
  last_active_at: string;
  create_key: string | null;
}

export class RoomRepo {
  constructor(private db: DatabaseSession) {}

  public create(room: {
    id: string;
    epoch: string;
    createdBy: string;
    passcodeHash?: string | null;
    passcodeVersion?: number;
    language?: string;
    locked?: boolean;
    createKey?: string | null;
  }): void {
    const stmt = this.db.prepare(
      `INSERT INTO rooms (
        id, epoch, passcode_hash, passcode_version, language, locked, created_by, create_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      room.id,
      room.epoch,
      room.passcodeHash ?? null,
      room.passcodeVersion ?? 0,
      room.language ?? 'javascript',
      room.locked ? 1 : 0,
      room.createdBy,
      room.createKey ?? null
    );
  }

  public findById(id: string): RoomRow | undefined {
    const stmt = this.db.prepare<RoomRow>(`SELECT * FROM rooms WHERE id = ?`);
    return stmt.get(id);
  }

  public findByCreateKey(createKey: string): RoomRow | undefined {
    const stmt = this.db.prepare<RoomRow>(`SELECT * FROM rooms WHERE create_key = ?`);
    return stmt.get(createKey);
  }

  public updateSettings(
    id: string,
    settings: {
      locked?: boolean;
      passcodeHash?: string | null;
      passcodeVersion?: number;
      language?: string;
    }
  ): void {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (settings.locked !== undefined) {
      fields.push('locked = ?');
      params.push(settings.locked ? 1 : 0);
    }
    if (settings.passcodeHash !== undefined) {
      fields.push('passcode_hash = ?');
      params.push(settings.passcodeHash);
    }
    if (settings.passcodeVersion !== undefined) {
      fields.push('passcode_version = ?');
      params.push(settings.passcodeVersion);
    }
    if (settings.language !== undefined) {
      fields.push('language = ?');
      params.push(settings.language);
    }

    if (fields.length === 0) return;

    fields.push("last_active_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    params.push(id);

    const query = `UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(query).run(...params);
  }

  public updateSnapshot(id: string, snapshot: Uint8Array, snapshotAt: string): void {
    const stmt = this.db.prepare(
      `UPDATE rooms SET snapshot = ?, snapshot_at = ?, last_active_at = ? WHERE id = ?`
    );
    stmt.run(snapshot, snapshotAt, snapshotAt, id);
  }

  public touchLastActive(id: string): void {
    const stmt = this.db.prepare(
      `UPDATE rooms SET last_active_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    );
    stmt.run(id);
  }
}
