import { DatabaseSession } from '../db/database.js';

export interface RoomUpdateRow {
  id: number;
  room_id: string;
  update_data: Uint8Array;
  created_at: string;
}

export class UpdateRepo {
  constructor(private db: DatabaseSession) {}

  public insertBatch(roomId: string, updateData: Uint8Array): number {
    const stmt = this.db.prepare(
      `INSERT INTO room_updates (room_id, update_data) VALUES (?, ?)`
    );
    const result = stmt.run(roomId, updateData);
    return Number(result.lastInsertRowid);
  }

  public getTailAfter(roomId: string, afterId: number = 0): RoomUpdateRow[] {
    const stmt = this.db.prepare<RoomUpdateRow>(
      `SELECT * FROM room_updates WHERE room_id = ? AND id > ? ORDER BY id ASC`
    );
    return stmt.all(roomId, afterId);
  }

  public compactBefore(roomId: string, beforeId: number): number {
    const stmt = this.db.prepare(
      `DELETE FROM room_updates WHERE room_id = ? AND id <= ?`
    );
    const result = stmt.run(roomId, beforeId);
    return Number(result.changes);
  }

  public countUpdates(roomId: string): number {
    const stmt = this.db.prepare<{ count: number }>(
      `SELECT COUNT(*) as count FROM room_updates WHERE room_id = ?`
    );
    return stmt.get(roomId)?.count ?? 0;
  }
}
