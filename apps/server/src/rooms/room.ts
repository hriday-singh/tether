import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import WebSocket from 'ws';
import { HostElector } from './hostElector.js';
import { OutboundThrottle } from '../sync/outboundThrottle.js';
import { FloodGuard } from '../sync/floodGuard.js';
import { AwarenessBinding } from '../sync/awarenessBinding.js';
import { PersistenceService } from '../services/persistenceService.js';
import { AuditService } from '../services/auditService.js';
import { encodeFrame, BinaryFrame } from '@tether/shared/protocol/codec';
import { ServerControlMessage } from '@tether/shared/protocol/schemas';
import { FRAME_KINDS, CHECKSUM_QUIET_MS } from '@tether/shared/constants';
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
  private checksumQuietTimer: NodeJS.Timeout | null = null;
  public lastActiveAt: number;

  constructor(
    id: string,
    epoch: string,
    initialSnapshot: Uint8Array | null,
    tailUpdates: Uint8Array[],
    private persistenceService: PersistenceService,
    private auditService: AuditService
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

    this.hostElector = new HostElector({
      onHostChanged: (newHostId, reason) => {
        this.broadcastControl({
          t: 'host.changed',
          hostId: newHostId,
          reason,
        });
        this.auditService.logEvent(this.id, {
          type: 'host.changed',
          payload: { hostId: newHostId, reason },
        });
      },
    });

    this.doc.on('update', this.handleDocUpdate);
  }

  private handleDocUpdate = (): void => {
    this.lastActiveAt = Date.now();
    this.scheduleChecksum();
  };

  private scheduleChecksum(): void {
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

  public addConnection(ws: WebSocket, member: { id: string; name: string; colorIndex: number }): RoomConnectionContext {
    this.lastActiveAt = Date.now();
    this.connections.add(ws);

    const awarenessBinding = new AwarenessBinding(member.id, this.claimedClientIDs);
    const floodGuard = new FloodGuard();

    const throttle = new OutboundThrottle({
      broadcastFn: (docUpdate, awUpdate) => {
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
            conn.send(encoded);
          }
        }
      },
      onThrottledNotice: (windowMs) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'throttled', windowMs }));
        }
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
    this.hostElector.addMember(member.id);

    return ctx;
  }

  public removeConnection(ws: WebSocket, isCleanLeave = false): void {
    this.lastActiveAt = Date.now();
    const ctx = this.connContexts.get(ws);
    if (!ctx) return;

    this.connections.delete(ws);
    this.connContexts.delete(ws);

    ctx.throttle.destroy();
    ctx.awarenessBinding.cleanup();

    this.hostElector.disconnectConnection(ctx.memberId, isCleanLeave);
  }

  public handleInboundUpdate(ws: WebSocket, seq: number, docUpdate: Uint8Array, awarenessUpdate: Uint8Array): void {
    this.lastActiveAt = Date.now();
    const ctx = this.connContexts.get(ws);
    if (!ctx) return;

    // Check flood
    const floodCode = ctx.floodGuard.checkFrame(docUpdate.byteLength + awarenessUpdate.byteLength);
    if (floodCode) {
      ws.close(floodCode);
      return;
    }

    // Apply doc update to in-memory doc immediately (Invariant I5)
    if (docUpdate.byteLength > 0) {
      Y.applyUpdate(this.doc, docUpdate, this);

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
        conn.send(payload);
      }
    }
  }

  public get connectionCount(): number {
    return this.connections.size;
  }

  public destroy(): void {
    if (this.checksumQuietTimer) {
      clearTimeout(this.checksumQuietTimer);
      this.checksumQuietTimer = null;
    }
    this.hostElector.destroy();
    for (const ctx of this.connContexts.values()) {
      ctx.throttle.destroy();
      ctx.awarenessBinding.cleanup();
    }
    this.connections.clear();
    this.connContexts.clear();
    this.doc.off('update', this.handleDocUpdate);
    this.doc.destroy();
  }
}
