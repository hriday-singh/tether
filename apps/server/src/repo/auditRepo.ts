import { DatabaseSession } from '../db/database.js';

export interface AuditEventRow {
  id: number;
  room_id: string;
  seq: number;
  type: string;
  actor_member_id: string | null;
  actor_name: string | null;
  payload: string; // JSON string
  created_at: string;
}

export class AuditRepo {
  constructor(private db: DatabaseSession) {}

  public insertBatch(
    events: Array<{
      roomId: string;
      seq: number;
      type: string;
      actorMemberId?: string | null;
      actorName?: string | null;
      payload?: Record<string, unknown>;
    }>
  ): void {
    if (events.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT INTO audit_events (
        room_id, seq, type, actor_member_id, actor_name, payload
      ) VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const ev of events) {
      stmt.run(
        ev.roomId,
        ev.seq,
        ev.type,
        ev.actorMemberId ?? null,
        ev.actorName ?? null,
        JSON.stringify(ev.payload ?? {})
      );
    }
  }

  public getLatestSeq(roomId: string): number {
    const stmt = this.db.prepare<{ maxSeq: number | null }>(
      `SELECT MAX(seq) as maxSeq FROM audit_events WHERE room_id = ?`
    );
    const result = stmt.get(roomId);
    return result?.maxSeq ?? 0;
  }

  public getEventsBefore(roomId: string, beforeSeq: number, limit = 50): AuditEventRow[] {
    const stmt = this.db.prepare<AuditEventRow>(
      `SELECT * FROM audit_events
       WHERE room_id = ? AND seq < ?
       ORDER BY seq DESC
       LIMIT ?`
    );
    return stmt.all(roomId, beforeSeq, Math.min(100, Math.max(1, limit)));
  }

  public getEventsAfter(roomId: string, afterSeq: number, limit = 50): AuditEventRow[] {
    const stmt = this.db.prepare<AuditEventRow>(
      `SELECT * FROM audit_events
       WHERE room_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`
    );
    return stmt.all(roomId, afterSeq, Math.min(100, Math.max(1, limit)));
  }
}
