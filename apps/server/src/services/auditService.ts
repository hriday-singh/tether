import { AuditRepo, AuditEventRow, FormattedAuditEvent } from '../repo/auditRepo.js';

export class AuditService {
  private seqCounters = new Map<string, number>();
  public onEventLogged?: (roomId: string, event: FormattedAuditEvent) => void;

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
  ): FormattedAuditEvent {
    const seq = this.getNextSeq(roomId);
    const formatted = this.auditRepo.insertEvent({
      roomId,
      seq,
      type: event.type,
      actorMemberId: event.actorMemberId ?? null,
      actorName: event.actorName ?? null,
      payload: event.payload ?? {},
    });
    this.onEventLogged?.(roomId, formatted);
    return formatted;
  }

  public getEventsBefore(roomId: string, beforeSeq?: number, limit = 50): AuditEventRow[] {
    const seq = beforeSeq ?? this.getNextSeq(roomId);
    return this.auditRepo.getEventsBefore(roomId, seq, limit);
  }

  public getEventsAfter(roomId: string, afterSeq: number, limit = 50): AuditEventRow[] {
    return this.auditRepo.getEventsAfter(roomId, afterSeq, limit);
  }
}
