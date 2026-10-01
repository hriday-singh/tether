import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import WebSocket from 'ws';
import { HostElector } from './hostElector.js';
import { OutboundThrottle } from '../sync/outboundThrottle.js';
import { FloodGuard } from '../sync/floodGuard.js';
import { AwarenessBinding } from '../sync/awarenessBinding.js';
import { EditSummaryCoalescer } from '../sync/editCoalescer.js';
import { PersistenceService } from '../services/persistenceService.js';
import { AuditService } from '../services/auditService.js';
import { encodeFrame, BinaryFrame } from '@tether/shared/protocol/codec';
import { ServerControlMessage } from '@tether/shared/protocol/schemas';
import {
  FRAME_KINDS,
  CHECKSUM_QUIET_MS,
  WS_CLOSE_CODES,
  MAX_DOC_BYTES,
  SLOW_CONSUMER_BYTES,
} from '@tether/shared/constants';
import { hashString } from '@tether/shared/checksum';

export interface RoomConnectionContext {
  memberId: string;
  displayName: string;
  colorIndex: number;
  throttle: OutboundThrottle;
  floodGuard: FloodGuard;
  awarenessBinding: AwarenessBinding;
  ws: WebSocket;
}

export class Room {
  public readonly id: string;
  public readonly epoch: string;
  public readonly doc: Y.Doc;
  public readonly awareness: awarenessProtocol.Awareness;
  public readonly hostElector: HostElector;

  private connections = new Set<WebSocket>();
  private connContexts = new Map<WebSocket, RoomConnectionContext>();
  private claimedClientIDs = new Map<number, string>();
  private botMemberIds = new Set<string>();
  /** memberId -> display name, so feed events never fall back to raw ids once the socket is gone. */
  private memberNames = new Map<string, string>();
  private checksumQuietTimer: NodeJS.Timeout | null = null;
  private editCoalescer: EditSummaryCoalescer;
  // Upper-bound estimate of the encoded doc size; Infinity forces an exact measure on the first update.
  private sizeEstimate = Infinity;
  public lastActiveAt: number;

  constructor(
    id: string,
    epoch: string,
    initialSnapshot: Uint8Array | null,
    tailUpdates: Uint8Array[],
    private persistenceService: PersistenceService,
    private auditService: AuditService,
    private onBroadcast?: (sourceMemberId: string, timestamp: number) => void,
    hostGraceMs?: number
  ) {
    this.id = id;
    this.epoch = epoch;
    this.lastActiveAt = Date.now();

    this.doc = new Y.Doc();
    if (initialSnapshot && initialSnapshot.byteLength > 0) {
      Y.applyUpdate(this.doc, initialSnapshot);
    }
    for (const update of tailUpdates) {
      if (update.byteLength > 0) {
        Y.applyUpdate(this.doc, update);
      }
    }

    this.awareness = new awarenessProtocol.Awareness(this.doc);

    this.editCoalescer = new EditSummaryCoalescer(this.doc, {
      onEmitSummary: (memberId, memberName, summary) => {
        this.auditService.logEvent(this.id, {
          type: 'edit.summary',
          actorMemberId: memberId,
          actorName: memberName,
          payload: {
            inserted: summary.inserted,
            deleted: summary.deleted,
            lines: summary.lines,
          },
        });
      },
    });

    this.hostElector = new HostElector({
      graceMs: hostGraceMs,
      onHostChanged: (newHostId, reason, previousHostId) => {
        this.broadcastControl({
          t: 'host.changed',
          hostId: newHostId,
          reason,
        });
        this.auditService.logEvent(this.id, {
          type: 'host.changed',
          payload: {
            from: previousHostId,
            to: newHostId,
            toName: newHostId ? this.memberNames.get(newHostId) ?? null : null,
            reason,
          },
        });
      },
      onMemberRemoved: (memberId, reason) => {
        this.broadcastControl({
          t: 'member.left',
          memberId,
          reason,
        });
        this.auditService.logEvent(this.id, {
          type: 'member.left',
          actorMemberId: memberId,
          actorName: this.memberNames.get(memberId) ?? null,
          payload: { reason },
        });
      },
    });

    this.doc.on('update', this.handleDocUpdate);
  }

  private handleDocUpdate = (): void => {
    this.lastActiveAt = Date.now();
    this.scheduleChecksum();
  };

  /** Debounced server checksum broadcast; clients compare it with their replica to verify sync. */
  public scheduleChecksum(): void {
    if (this.checksumQuietTimer) {
      clearTimeout(this.checksumQuietTimer);
    }
    this.checksumQuietTimer = setTimeout(() => {
      this.checksumQuietTimer = null;
      this.broadcastChecksum();
    }, CHECKSUM_QUIET_MS);
  }

  private broadcastChecksum(): void {
    const sv = Buffer.from(Y.encodeStateVector(this.doc)).toString('base64');
    const text = this.doc.getText('codemirror').toString();
    const hash = hashString(text);

    this.broadcastControl({
      t: 'checksum',
      sv,
      hash,
    });
  }

  public markBot(memberId: string): void {
    this.botMemberIds.add(memberId);
  }

  public isBot(memberId: string): boolean {
    return this.botMemberIds.has(memberId);
  }

  /** Distinct humans connected right now (Chaos bots and departed members excluded). */
  public get humanCount(): number {
    const ids = new Set<string>();
    for (const ctx of this.connContexts.values()) {
      if (!this.botMemberIds.has(ctx.memberId)) ids.add(ctx.memberId);
    }
    return ids.size;
  }

  public addConnection(
    ws: WebSocket,
    member: { id: string; name: string; colorIndex: number },
    isBot = false
  ): { ctx: RoomConnectionContext; isNew: boolean } {
    this.lastActiveAt = Date.now();
    this.connections.add(ws);
    if (isBot) {
      this.botMemberIds.add(member.id);
    }
    this.memberNames.set(member.id, member.name);

    const awarenessBinding = new AwarenessBinding(member.id, this.claimedClientIDs);
    const floodGuard = new FloodGuard();

    const throttle = new OutboundThrottle({
      broadcastFn: (docUpdate, awUpdate) => {
        this.onBroadcast?.(member.id, Date.now());
        const frame: BinaryFrame = {
          kind: FRAME_KINDS.UPDATE,
          seq: 0,
          docUpdate,
          awarenessUpdate: awUpdate,
        };
        const encoded = encodeFrame(frame);
        // Broadcast to all other connections in the room
        for (const conn of this.connections) {
          if (conn !== ws && conn.readyState === WebSocket.OPEN) {
            if (conn.bufferedAmount > SLOW_CONSUMER_BYTES) {
              conn.close(WS_CLOSE_CODES.SLOW_CONSUMER);
              continue;
            }
            conn.send(encoded);
          }
        }
      },
      onThrottledNotice: (windowMs) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'throttled', windowMs }));
        }
        this.auditService.logEvent(this.id, {
          type: 'throttle.applied',
          actorMemberId: member.id,
          actorName: member.name,
          payload: { windowMs },
        });
      },
    });

    const ctx: RoomConnectionContext = {
      memberId: member.id,
      displayName: member.name,
      colorIndex: member.colorIndex,
      throttle,
      floodGuard,
      awarenessBinding,
      ws,
    };

    this.connContexts.set(ws, ctx);
    const { isNew, isReconnecting } = this.hostElector.addMember(member.id, undefined, !isBot);

    // Member came back within the grace window, tell everyone they're active again.
    if (isReconnecting) {
      this.broadcastControl({ t: 'member.status', memberId: member.id, status: 'active' });
    }

    return { ctx, isNew };
  }

  public terminateMemberSockets(memberId: string, closeCode: number = WS_CLOSE_CODES.KICKED): void {
    for (const [conn, ctx] of this.connContexts.entries()) {
      if (ctx.memberId === memberId) {
        conn.close(closeCode);
      }
    }
  }

  public removeConnection(ws: WebSocket, isCleanLeave = false): void {
    this.lastActiveAt = Date.now();
    const ctx = this.connContexts.get(ws);
    if (!ctx) return;

    this.connections.delete(ws);
    this.connContexts.delete(ws);

    const claimedClientID = ctx.awarenessBinding.getClaimedClientID();
    if (claimedClientID !== null) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [claimedClientID], this);
      const awUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [claimedClientID]);
      const frame: BinaryFrame = {
        kind: FRAME_KINDS.UPDATE,
        seq: 0,
        docUpdate: new Uint8Array(0),
        awarenessUpdate: awUpdate,
      };
      const encoded = encodeFrame(frame);
      for (const conn of this.connections) {
        if (conn.readyState === WebSocket.OPEN) {
          if (conn.bufferedAmount > SLOW_CONSUMER_BYTES) {
            conn.close(WS_CLOSE_CODES.SLOW_CONSUMER);
            continue;
          }
          conn.send(encoded);
        }
      }
    }

    ctx.throttle.destroy();
    ctx.awarenessBinding.cleanup();
    this.editCoalescer.flushMember(ctx.memberId);

    this.hostElector.disconnectConnection(ctx.memberId, isCleanLeave);

    // Abrupt disconnect enters the grace window; tell remaining clients so the
    // roster shows "reconnecting…" instead of appearing fully active.
    if (!isCleanLeave) {
      this.broadcastControl({ t: 'member.status', memberId: ctx.memberId, status: 'reconnecting' });
    }
  }

  /**
   * Doc-size guard without a full-doc encode per update (that was ~460us + a doc-sized
   * allocation per keystroke at 100 KB). Merging an update grows the encoded doc by at most
   * ~2x its bytes in measurements (struct splits); 16x is the margin. Exact encode only when
   * the estimate crosses the cap.
   * ponytail: margin is empirical; if it's ever exceeded, the doc overshoots the cap slightly
   * until the next crossing triggers an exact measure.
   */
  private exceedsMaxDocSize(updateBytes: number): boolean {
    this.sizeEstimate += updateBytes * 16;
    if (this.sizeEstimate <= MAX_DOC_BYTES) return false;
    this.sizeEstimate = Y.encodeStateAsUpdate(this.doc).byteLength;
    return this.sizeEstimate > MAX_DOC_BYTES;
  }

  public handleInboundSyncStep2(ws: WebSocket, update: Uint8Array): void {
    if (update.byteLength === 0) return;
    this.lastActiveAt = Date.now();
    const ctx = this.connContexts.get(ws);
    const origin = ctx ? { memberId: ctx.memberId, name: ctx.displayName } : this;

    if (this.persistenceService.isBufferFull()) {
      this.auditService.logEvent(this.id, {
        type: 'security.buffer_full',
        actorMemberId: ctx?.memberId ?? null,
        actorName: ctx?.displayName ?? null,
        payload: { reason: 'persistence_buffer_full' },
      });
      ws.close(WS_CLOSE_CODES.RESTART);
      return;
    }

    Y.applyUpdate(this.doc, update, origin);

    if (this.exceedsMaxDocSize(update.byteLength)) {
      ws.close(WS_CLOSE_CODES.DOC_TOO_LARGE);
      return;
    }

    this.persistenceService.enqueueUpdate(this.id, update);

    if (ctx) {
      ctx.throttle.enqueue(update, new Uint8Array(0));
    }
  }

  public handleInboundUpdate(ws: WebSocket, seq: number, docUpdate: Uint8Array, awarenessUpdate: Uint8Array): void {
    this.lastActiveAt = Date.now();
    const ctx = this.connContexts.get(ws);
    if (!ctx) return;

    // Check flood
    const floodCode = ctx.floodGuard.checkFrame(docUpdate.byteLength + awarenessUpdate.byteLength);
    if (floodCode) {
      this.auditService.logEvent(this.id, {
        type: 'security.flood',
        actorMemberId: ctx.memberId,
        actorName: ctx.displayName,
        payload: { code: floodCode },
      });
      ws.close(floodCode);
      return;
    }

    // Apply doc update to in-memory doc immediately (Invariant I5)
    if (docUpdate.byteLength > 0) {
      if (this.persistenceService.isBufferFull()) {
        this.auditService.logEvent(this.id, {
          type: 'security.buffer_full',
          actorMemberId: ctx.memberId,
          actorName: ctx.displayName,
          payload: { reason: 'persistence_buffer_full' },
        });
        ws.close(WS_CLOSE_CODES.RESTART);
        return;
      }

      Y.applyUpdate(this.doc, docUpdate, { memberId: ctx.memberId, name: ctx.displayName });

      if (this.exceedsMaxDocSize(docUpdate.byteLength)) {
        ws.close(WS_CLOSE_CODES.DOC_TOO_LARGE);
        return;
      }

      // Enqueue to persistence service with ack recipient (Invariant I6)
      this.persistenceService.enqueueUpdate(this.id, docUpdate, {
        seq,
        sendAck: (s) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'ack', seq: s }));
          }
        },
      });
    }

    // Process and validate awareness update
    let filteredAw: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    if (awarenessUpdate.byteLength > 0) {
      const awResult = ctx.awarenessBinding.filterAwarenessUpdate(awarenessUpdate);
      if (awResult.closeCode) {
        this.auditService.logEvent(this.id, {
          type: 'security.protocol',
          actorMemberId: ctx.memberId,
          actorName: ctx.displayName,
          payload: { code: awResult.closeCode },
        });
        ws.close(awResult.closeCode);
        return;
      }
      if (awResult.validUpdate) {
        filteredAw = awResult.validUpdate;
        awarenessProtocol.applyAwarenessUpdate(this.awareness, filteredAw as unknown as Uint8Array, this);
      }
    }

    // Hand to connection's OutboundThrottle for lossless rate-limited broadcast
    ctx.throttle.enqueue(docUpdate, filteredAw);
  }

  public broadcastControl(msg: ServerControlMessage, excludeWs?: WebSocket): void {
    const payload = JSON.stringify(msg);
    for (const conn of this.connections) {
      if (conn !== excludeWs && conn.readyState === WebSocket.OPEN) {
        if (conn.bufferedAmount > SLOW_CONSUMER_BYTES) {
          conn.close(WS_CLOSE_CODES.SLOW_CONSUMER);
          continue;
        }
        conn.send(payload);
      }
    }
  }

  public get connectionCount(): number {
    return this.connections.size;
  }

  public destroy(closeCode: number = WS_CLOSE_CODES.RESTART): void {
    if (this.checksumQuietTimer) {
      clearTimeout(this.checksumQuietTimer);
      this.checksumQuietTimer = null;
    }
    this.editCoalescer.destroy();
    this.hostElector.destroy();
    for (const [conn, ctx] of this.connContexts.entries()) {
      ctx.throttle.destroy();
      ctx.awarenessBinding.cleanup();
      if (conn.readyState === WebSocket.OPEN) {
        conn.close(closeCode, 'Server Restarting');
      }
    }
    this.connections.clear();
    this.connContexts.clear();
    this.doc.off('update', this.handleDocUpdate);
    this.doc.destroy();
  }
}
