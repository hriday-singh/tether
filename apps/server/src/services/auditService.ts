import { AuditRepo, AuditEventRow } from '../repo/auditRepo.js';

export class AuditService {
  private seqCounters = new Map<string, number>();

  constructor(private auditRepo: AuditRepo) {}

  private getNextSeq(roomId: string): number {
    let current = this.seqCounters.get(roomId);
    if (current === undefined) {
      current = this.auditRepo.getLatestSeq(roomId);
    }
    const next = current + 1;
    this.seqCounters.set(roomId, next);
    return next;
  }

  public logEvent(
    roomId: string,
    event: {
      type: string;
      actorMemberId?: string | null;
      actorName?: string | null;
      payload?: Record<string, unknown>;
    }
  ): number {
    const seq = this.getNextSeq(roomId);
    this.auditRepo.insertBatch([
      {
        roomId,
        seq,
        type: event.type,
        actorMemberId: event.actorMemberId ?? null,
        actorName: event.actorName ?? null,
        payload: event.payload ?? {},
      },
    ]);
    return seq;
  }

  public getEventsBefore(roomId: string, beforeSeq?: number, limit = 50): AuditEventRow[] {
    const seq = beforeSeq ?? this.getNextSeq(roomId);
    return this.auditRepo.getEventsBefore(roomId, seq, limit);
  }

  public getEventsAfter(roomId: string, afterSeq: number, limit = 50): AuditEventRow[] {
    return this.auditRepo.getEventsAfter(roomId, afterSeq, limit);
  }
}
