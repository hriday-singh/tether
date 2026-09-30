import type { ChatMessage } from '@tether/shared/protocol/schemas';
import { DatabaseSession } from '../db/database.js';

export interface ChatMessageRow {
  id: number;
  room_id: string;
  seq: number;
  client_msg_id: string;
  member_id: string;
  display_name: string;
  color_index: number;
  body: string;
  created_at: string;
}

export interface NewChatMessage {
  roomId: string;
  seq: number;
  clientMsgId: string;
  memberId: string;
  name: string;
  colorIndex: number;
  text: string;
}

export function formatChatRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    seq: row.seq,
    clientMsgId: row.client_msg_id,
    memberId: row.member_id,
    name: row.display_name,
    colorIndex: row.color_index,
    text: row.body,
    createdAt: row.created_at,
  };
}

const clampLimit = (limit: number) => Math.min(100, Math.max(1, limit));

export class ChatRepo {
  constructor(private db: DatabaseSession) {}

  public insert(msg: NewChatMessage): ChatMessage {
    const res = this.db
      .prepare(
        `INSERT INTO chat_messages (
          room_id, seq, client_msg_id, member_id, display_name, color_index, body
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(msg.roomId, msg.seq, msg.clientMsgId, msg.memberId, msg.name, msg.colorIndex, msg.text);
    const id = Number(res.lastInsertRowid);
    const row = this.db.prepare<ChatMessageRow>(`SELECT * FROM chat_messages WHERE id = ?`).get(id);
    if (!row) throw new Error(`chat message ${id} vanished after insert`);
    return formatChatRow(row);
  }

  public findByClientMsgId(roomId: string, clientMsgId: string): ChatMessage | null {
    const row = this.db
      .prepare<ChatMessageRow>(`SELECT * FROM chat_messages WHERE room_id = ? AND client_msg_id = ?`)
      .get(roomId, clientMsgId);
    return row ? formatChatRow(row) : null;
  }

  public getLatestSeq(roomId: string): number {
    const result = this.db
      .prepare<{ maxSeq: number | null }>(`SELECT MAX(seq) as maxSeq FROM chat_messages WHERE room_id = ?`)
      .get(roomId);
    return result?.maxSeq ?? 0;
  }

  /** Newest first. */
  public getBefore(roomId: string, beforeSeq: number, limit = 50): ChatMessage[] {
    return this.db
      .prepare<ChatMessageRow>(
        `SELECT * FROM chat_messages WHERE room_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`
      )
      .all(roomId, beforeSeq, clampLimit(limit))
      .map(formatChatRow);
  }

  /** Oldest first. */
  public getAfter(roomId: string, afterSeq: number, limit = 50): ChatMessage[] {
    return this.db
      .prepare<ChatMessageRow>(
        `SELECT * FROM chat_messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
      )
      .all(roomId, afterSeq, clampLimit(limit))
      .map(formatChatRow);
  }
}
