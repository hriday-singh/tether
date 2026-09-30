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

  /** Drop the cached seq for an unloaded room; getNextSeq re-reads it from the DB on next use. */
  public forgetRoom(roomId: string): void {
    this.seqCounters.delete(roomId);
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
    // Open upper bound when no cursor. Not getNextSeq(): that increments the counter and punches holes in the sequence.
    const seq = beforeSeq ?? Number.MAX_SAFE_INTEGER;
    return this.auditRepo.getEventsBefore(roomId, seq, limit);
  }

  public getEventsAfter(roomId: string, afterSeq: number, limit = 50): AuditEventRow[] {
    return this.auditRepo.getEventsAfter(roomId, afterSeq, limit);
  }
}
