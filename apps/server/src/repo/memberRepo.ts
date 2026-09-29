import { DatabaseSession } from '../db/database.js';

export interface MemberRow {
  room_id: string;
  member_id: string;
  display_name: string;
  color_index: number;
  first_joined_at: string;
  last_seen_at: string;
  banned_at: string | null;
}

export class MemberRepo {
  constructor(private db: DatabaseSession) {}

  public upsertMember(member: {
    roomId: string;
    memberId: string;
    displayName: string;
    colorIndex: number;
  }): void {
    const stmt = this.db.prepare(
      `INSERT INTO room_members (room_id, member_id, display_name, color_index)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (room_id, member_id) DO UPDATE SET
         display_name = excluded.display_name,
         color_index = excluded.color_index,
         last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    );
    stmt.run(member.roomId, member.memberId, member.displayName, member.colorIndex);
  }

  public banMember(roomId: string, memberId: string): void {
    const stmt = this.db.prepare(
      `UPDATE room_members
       SET banned_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE room_id = ? AND member_id = ?`
    );
    const result = stmt.run(roomId, memberId);
    if (result.changes === 0) {
      // If member didn't have a row yet, insert as banned
      this.db
        .prepare(
          `INSERT INTO room_members (room_id, member_id, display_name, color_index, banned_at)
           VALUES (?, ?, 'Banned User', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
        )
        .run(roomId, memberId);
    }
  }

  public isBanned(roomId: string, memberId: string): boolean {
    const stmt = this.db.prepare<{ banned_at: string | null }>(
      `SELECT banned_at FROM room_members WHERE room_id = ? AND member_id = ?`
    );
    const row = stmt.get(roomId, memberId);
    return row !== undefined && row.banned_at !== null;
  }

  public getMembers(roomId: string): MemberRow[] {
    const stmt = this.db.prepare<MemberRow>(
      `SELECT * FROM room_members WHERE room_id = ? ORDER BY first_joined_at ASC`
    );
    return stmt.all(roomId);
  }

  public getMember(roomId: string, memberId: string): MemberRow | undefined {
    const stmt = this.db.prepare<MemberRow>(
      `SELECT * FROM room_members WHERE room_id = ? AND member_id = ?`
    );
    return stmt.get(roomId, memberId);
  }
}
