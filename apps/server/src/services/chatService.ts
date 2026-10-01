import type { ChatCodeRef, ChatMessage } from '@tether/shared/protocol/schemas';
import { ChatRepo } from '../repo/chatRepo.js';

export interface ChatPost {
  clientMsgId: string;
  memberId: string;
  name: string;
  colorIndex: number;
  text: string;
  ref?: ChatCodeRef | null;
}

/** Room chat (ADR-017). Own gapless per-room seq, same delivery rules as the audit feed (docs/04). */
export class ChatService {
  private seqCounters = new Map<string, number>();

  constructor(private chatRepo: ChatRepo) {}

  /** `created: false` means this clientMsgId was already stored (resend after reconnect). */
  public post(roomId: string, msg: ChatPost): { message: ChatMessage; created: boolean } {
    const existing = this.chatRepo.findByClientMsgId(roomId, msg.clientMsgId);
    if (existing) return { message: existing, created: false };

    const seq = (this.seqCounters.get(roomId) ?? this.chatRepo.getLatestSeq(roomId)) + 1;
    const message = this.chatRepo.insert({ roomId, seq, ...msg });
    this.seqCounters.set(roomId, seq);
    return { message, created: true };
  }

  public getLatestSeq(roomId: string): number {
    return this.seqCounters.get(roomId) ?? this.chatRepo.getLatestSeq(roomId);
  }

  public getBefore(roomId: string, beforeSeq: number | undefined, limit: number): ChatMessage[] {
    return this.chatRepo.getBefore(roomId, beforeSeq ?? Number.MAX_SAFE_INTEGER, limit);
  }

  public getAfter(roomId: string, afterSeq: number, limit: number): ChatMessage[] {
    return this.chatRepo.getAfter(roomId, afterSeq, limit);
  }
}
