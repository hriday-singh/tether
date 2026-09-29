import * as Y from 'yjs';
import { UpdateRepo } from '../repo/updateRepo.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { PERSIST_FLUSH_MS, COMPACT_AFTER_ROWS } from '@tether/shared/constants';

export interface AckRecipient {
  seq: number;
  sendAck: (seq: number) => void;
}

export class PersistenceService {
  private pendingUpdates = new Map<string, Uint8Array[]>();
  private pendingAcks = new Map<string, AckRecipient[]>();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private flushWindowMs: number;

  constructor(
    private updateRepo: UpdateRepo,
    private roomRepo: RoomRepo,
    flushWindowMs = PERSIST_FLUSH_MS
  ) {
    this.flushWindowMs = flushWindowMs;
  }

  public enqueueUpdate(
    roomId: string,
    update: Uint8Array,
    ackRecipient?: AckRecipient
  ): void {
    let list = this.pendingUpdates.get(roomId);
    if (!list) {
      list = [];
      this.pendingUpdates.set(roomId, list);
    }
    list.push(update);

    if (ackRecipient) {
      let acks = this.pendingAcks.get(roomId);
      if (!acks) {
        acks = [];
        this.pendingAcks.set(roomId, acks);
      }
      acks.push(ackRecipient);
    }

    if (!this.flushTimers.has(roomId)) {
      const timer = setTimeout(() => {
        this.flushTimers.delete(roomId);
        this.flush(roomId);
      }, this.flushWindowMs);
      this.flushTimers.set(roomId, timer);
    }
  }

  public flush(roomId: string, docForCompaction?: Y.Doc): number {
    const timer = this.flushTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(roomId);
    }

    const updates = this.pendingUpdates.get(roomId);
    if (!updates || updates.length === 0) {
      return 0;
    }

    this.pendingUpdates.delete(roomId);
    const acks = this.pendingAcks.get(roomId) ?? [];
    this.pendingAcks.delete(roomId);

    // Merge updates losslessly into one binary payload
    const merged = updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates);
    const lastId = this.updateRepo.insertBatch(roomId, merged);

    // Send acks only AFTER successful DB commit (Invariant I6)
    for (const ack of acks) {
      ack.sendAck(ack.seq);
    }

    // Check compaction
    if (docForCompaction) {
      const totalRows = this.updateRepo.countUpdates(roomId);
      if (totalRows >= COMPACT_AFTER_ROWS) {
        const snapshot = Y.encodeStateAsUpdate(docForCompaction);
        this.roomRepo.updateSnapshot(roomId, snapshot, new Date().toISOString());
        this.updateRepo.compactBefore(roomId, lastId);
      }
    }

    return lastId;
  }

  public destroy(): void {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
  }
}
