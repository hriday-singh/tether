import { HOST_GRACE_MS } from '@tether/shared/constants';

export interface ElectorMember {
  id: string;
  joinedAt: number; // Unix ms timestamp
  activeConnections: number;
  graceTimerExpiresAt: number | null;
}

export type HandoverReason = 'creator' | 'handover-leave' | 'handover-timeout' | 'manual';

export class HostElector {
  private members = new Map<string, ElectorMember>();
  private currentHostId: string | null = null;
  private graceMs: number;
  private clock: () => number;
  private pendingGraceTimers = new Map<string, NodeJS.Timeout>();
  private onHostChanged?: (newHostId: string | null, reason: HandoverReason) => void;
  private onMemberRemoved?: (memberId: string, reason: 'leave' | 'timeout') => void;

  constructor(options: {
    graceMs?: number;
    clock?: () => number;
    onHostChanged?: (newHostId: string | null, reason: HandoverReason) => void;
    onMemberRemoved?: (memberId: string, reason: 'leave' | 'timeout') => void;
  } = {}) {
    this.graceMs = options.graceMs ?? HOST_GRACE_MS;
    this.clock = options.clock ?? (() => Date.now());
    this.onHostChanged = options.onHostChanged;
    this.onMemberRemoved = options.onMemberRemoved;
  }

  public get hostId(): string | null {
    return this.currentHostId;
  }

  public addMember(memberId: string, joinedAt?: number): { isNew: boolean; isReconnecting: boolean } {
    const existing = this.members.get(memberId);
    if (existing) {
      existing.activeConnections++;
      if (existing.graceTimerExpiresAt !== null) {
        // Reconnected within grace window! Cancel timer & preserve seniority
        existing.graceTimerExpiresAt = null;
        const timer = this.pendingGraceTimers.get(memberId);
        if (timer) {
          clearTimeout(timer);
          this.pendingGraceTimers.delete(memberId);
        }
        return { isNew: false, isReconnecting: true };
      }
      return { isNew: false, isReconnecting: false };
    }

    const member: ElectorMember = {
      id: memberId,
      joinedAt: joinedAt ?? this.clock(),
      activeConnections: 1,
      graceTimerExpiresAt: null,
    };
    this.members.set(memberId, member);

    if (this.currentHostId === null) {
      this.elect('creator');
    }

    return { isNew: true, isReconnecting: false };
  }

  public disconnectConnection(memberId: string, isCleanLeave = false): void {
    const member = this.members.get(memberId);
    if (!member) return;

    member.activeConnections = Math.max(0, member.activeConnections - 1);

    if (member.activeConnections === 0) {
      if (isCleanLeave) {
        // Clean leave: immediate removal & immediate election
        this.removeMember(memberId, 'handover-leave');
      } else {
        // Abrupt disconnect: start grace timer
        const now = this.clock();
        member.graceTimerExpiresAt = now + this.graceMs;

        const timer = setTimeout(() => {
          this.pendingGraceTimers.delete(memberId);
          this.removeMember(memberId, 'handover-timeout');
        }, this.graceMs);

        this.pendingGraceTimers.set(memberId, timer);
      }
    }
  }

  private removeMember(memberId: string, reason: HandoverReason): void {
    this.members.delete(memberId);
    const timer = this.pendingGraceTimers.get(memberId);
    if (timer) {
      clearTimeout(timer);
      this.pendingGraceTimers.delete(memberId);
    }

    this.onMemberRemoved?.(memberId, reason === 'handover-leave' ? 'leave' : 'timeout');

    if (this.currentHostId === memberId) {
      this.currentHostId = null;
      this.elect(reason);
    }
  }

  public manualTransfer(targetMemberId: string): boolean {
    const target = this.members.get(targetMemberId);
    if (!target || target.activeConnections === 0) {
      return false;
    }
    this.setHost(targetMemberId, 'manual');
    return true;
  }

  /**
   * Pure election: electHost = argmin(joinedAt, tiebreak memberId)
   * over all eligible members (active or in grace).
   */
  public elect(reason: HandoverReason): void {
    let best: ElectorMember | null = null;

    for (const member of this.members.values()) {
      if (member.activeConnections > 0 || member.graceTimerExpiresAt !== null) {
        if (!best) {
          best = member;
        } else if (member.joinedAt < best.joinedAt) {
          best = member;
        } else if (member.joinedAt === best.joinedAt && member.id < best.id) {
          best = member;
        }
      }
    }

    const newHostId = best ? best.id : null;
    this.setHost(newHostId, reason);
  }

  private setHost(newHostId: string | null, reason: HandoverReason): void {
    if (this.currentHostId !== newHostId) {
      this.currentHostId = newHostId;
      this.onHostChanged?.(newHostId, reason);
    }
  }

  public destroy(): void {
    for (const timer of this.pendingGraceTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingGraceTimers.clear();
  }
}
