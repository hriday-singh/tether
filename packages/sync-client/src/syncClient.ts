import * as Y from 'yjs';
import WebSocket from 'ws';
import {
  encodeFrame,
  decodeFrame,
  BinaryFrame,
} from '@tether/shared/protocol/codec';
import {
  ClientControlMessage,
  ServerControlMessage,
  ServerControlMessageSchema,
  Member,
  RoomMetadata,
} from '@tether/shared/protocol/schemas';
import {
  CLIENT_BATCH_WINDOW_MS,
  CLIENT_PING_MS,
  CLIENT_DEAD_MS,
  FRAME_KINDS,
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  WAKE_PROBE_MS,
} from '@tether/shared/constants';
import { calculateBackoff } from '@tether/shared/backoff';
import { areStateVectorsEqual, hashString } from '@tether/shared/checksum';
import { StatsStore, ClientStats } from './statsStore.js';
import { WakeManager, WakeTarget, WakeDocumentTarget } from './wakeManager.js';

export type ClientConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'kicked'
  | 'offline';

export type SyncState = 'synced' | 'saving' | 'saved' | 'mismatch';

export interface SyncClientOptions {
  url: string;
  token: string;
  doc: Y.Doc;
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
  batchWindowMs?: number;
  onStatusChange?: (status: ClientConnectionStatus) => void;
  onSyncStateChange?: (state: SyncState) => void;
  onRosterChange?: (members: Member[]) => void;
  onHostChange?: (hostId: string | null) => void;
  onWelcome?: (welcome: { self: Member; room: RoomMetadata }) => void;
  onStatsChange?: (stats: ClientStats) => void;
  onError?: (err: Error) => void;
  clock?: () => number;
  statsWindowSize?: number;
  wakeProbeTimeoutMs?: number;
  wakeTarget?: {
    window?: WakeTarget;
    document?: WakeDocumentTarget;
  };
}

export class SyncClient {
  public readonly doc: Y.Doc;
  private url: string;
  private token: string;
  private ws: WebSocket | null = null;
  private webSocketFactory: (url: string, protocols?: string | string[]) => WebSocket;
  private batchWindowMs: number;
  private clock: () => number;

  private status: ClientConnectionStatus = 'disconnected';
  private syncState: SyncState = 'synced';
  private seq = 1;
  private reconnectAttempts = 0;
  private isDestroyed = false;

  private pendingDocUpdates: Uint8Array[] = [];
  private pendingAwarenessUpdate: Uint8Array = new Uint8Array(0);
  private pendingAcks = new Map<number, { docUpdate: Uint8Array; sentAt: number }>();

  private statsStore: StatsStore;
  private wakeManager: WakeManager | null = null;

  private lastSentAt = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private deadTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public members: Member[] = [];
  public hostId: string | null = null;
  public room: RoomMetadata | null = null;
  public self: Member | null = null;

  private onStatusChange?: (status: ClientConnectionStatus) => void;
  private onSyncStateChange?: (state: SyncState) => void;
  private onRosterChange?: (members: Member[]) => void;
  private onHostChange?: (hostId: string | null) => void;
  private onWelcome?: (welcome: { self: Member; room: RoomMetadata }) => void;
  private onStatsChange?: (stats: ClientStats) => void;
  private onError?: (err: Error) => void;

  constructor(options: SyncClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.doc = options.doc;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url, protocols) => new (globalThis.WebSocket as unknown as typeof WebSocket)(url, protocols));
    this.batchWindowMs = options.batchWindowMs ?? CLIENT_BATCH_WINDOW_MS;
    this.clock = options.clock ?? (() => Date.now());

    this.onStatusChange = options.onStatusChange;
    this.onSyncStateChange = options.onSyncStateChange;
    this.onRosterChange = options.onRosterChange;
    this.onHostChange = options.onHostChange;
    this.onWelcome = options.onWelcome;
    this.onStatsChange = options.onStatsChange;
    this.onError = options.onError;

    this.statsStore = new StatsStore(options.statsWindowSize ?? 60);

    this.wakeManager = new WakeManager({
      probeTimeoutMs: options.wakeProbeTimeoutMs ?? WAKE_PROBE_MS,
      target: options.wakeTarget,
      onWakePing: () => {
        if (this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
          this.sendPing();
          this.wakeManager?.startProbe();
        } else if (
          this.status === 'disconnected' ||
          this.status === 'reconnecting' ||
          this.status === 'offline'
        ) {
          this.reconnectAttempts = 0;
          this.connect();
        }
      },
      onWakeTimeout: () => {
        if (this.status === 'connected') {
          this.ws?.terminate?.() ?? this.ws?.close();
          this.reconnectAttempts = 0;
          this.connect();
        }
      },
      onOffline: () => {
        if (this.status !== 'kicked' && !this.isDestroyed) {
          this.setStatus('offline');
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
        }
      },
    });

    // Listen to local Y.Doc updates
    this.doc.on('update', this.handleLocalDocUpdate);
  }

  private setStatus(status: ClientConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.onStatusChange?.(status);
    }
  }

  private setSyncState(state: SyncState): void {
    if (this.syncState !== state) {
      this.syncState = state;
      this.onSyncStateChange?.(state);
    }
  }

  public connect(): void {
    if (this.isDestroyed || this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const protocols = [PROTOCOL_VERSION, this.token];

    try {
      this.ws = this.webSocketFactory(this.url, protocols);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = this.handleOpen;
      this.ws.onmessage = this.handleMessage;
      this.ws.onerror = (event) => this.handleWsError(event);
      this.ws.onclose = this.handleClose;
    } catch (err) {
      this.handleWsError(err);
    }
  }

  private handleOpen = (): void => {
    this.reconnectAttempts = 0;
    this.resetDeadTimer();
    this.startPingTimer();

    // Step 1: Send client state vector
    const sv = Y.encodeStateVector(this.doc);
    const step1Frame = encodeFrame({
      kind: FRAME_KINDS.SYNC_STEP1,
      stateVector: sv,
    });
    this.sendRaw(step1Frame);
  };

  private handleMessage = (event: WebSocket.MessageEvent): void => {
    this.resetDeadTimer();
    const data = event.data;

    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      this.handleBinaryFrame(buffer);
    } else if (typeof data === 'string') {
      this.handleControlMessage(data);
    }
  };

  private handleBinaryFrame(buffer: Uint8Array): void {
    const frame = decodeFrame(buffer);

    switch (frame.kind) {
      case FRAME_KINDS.SYNC_STEP1: {
        // Server sent its state vector; reply with missing updates
        const update = Y.encodeStateAsUpdate(this.doc, frame.stateVector);
        const step2 = encodeFrame({
          kind: FRAME_KINDS.SYNC_STEP2,
          seq: 0,
          update,
        });
        this.sendRaw(step2);
        break;
      }
      case FRAME_KINDS.SYNC_STEP2: {
        // Server sent updates missing on client
        if (frame.update.byteLength > 0) {
          Y.applyUpdate(this.doc, frame.update, this);
        }
        break;
      }
      case FRAME_KINDS.UPDATE: {
        // Broadcast from peers
        if (frame.docUpdate.byteLength > 0) {
          Y.applyUpdate(this.doc, frame.docUpdate, this);
        }
        break;
      }
    }
  }

  private handleControlMessage(jsonStr: string): void {
    try {
      const raw = JSON.parse(jsonStr);
      const parsed: ServerControlMessage = ServerControlMessageSchema.parse(raw);

      switch (parsed.t) {
        case 'welcome': {
          this.self = parsed.self;
          this.members = parsed.members;
          this.hostId = parsed.hostId;
          this.room = parsed.room;
          this.setStatus('connected');
          this.pendingAcks.clear();
          this.setSyncState('synced');
          this.onWelcome?.({ self: parsed.self, room: parsed.room });
          this.onRosterChange?.(parsed.members);
          this.onHostChange?.(parsed.hostId);
          break;
        }
        case 'pong': {
          const now = this.clock();
          const rtt = Math.max(0, now - parsed.ts);
          this.statsStore.recordRtt(rtt);
          this.wakeManager?.clearProbe();
          this.onStatsChange?.(this.statsStore.getStats());
          break;
        }
        case 'ack': {
          const pending = this.pendingAcks.get(parsed.seq);
          if (pending) {
            const ackLatency = Math.max(0, this.clock() - pending.sentAt);
            this.statsStore.recordAckLatency(ackLatency);
            this.pendingAcks.delete(parsed.seq);
            this.onStatsChange?.(this.statsStore.getStats());
          }
          if (this.pendingAcks.size === 0) {
            this.setSyncState('saved');
          }
          break;
        }
        case 'member.joined': {
          this.members = [...this.members.filter((m) => m.id !== parsed.member.id), parsed.member];
          this.onRosterChange?.(this.members);
          break;
        }
        case 'member.left': {
          this.members = this.members.filter((m) => m.id !== parsed.memberId);
          this.onRosterChange?.(this.members);
          break;
        }
        case 'host.changed': {
          this.hostId = parsed.hostId;
          this.onHostChange?.(parsed.hostId);
          break;
        }
        case 'checksum': {
          const localSv = Y.encodeStateVector(this.doc);
          const localText = this.doc.getText('codemirror').toString();
          const localHash = hashString(localText);

          if (areStateVectorsEqual(localSv, Buffer.from(parsed.sv, 'base64')) && localHash === parsed.hash) {
            this.setSyncState('synced');
          } else {
            this.setSyncState('mismatch');
            this.sendControl({
              t: 'verify.mismatch',
              sv: Buffer.from(localSv).toString('base64'),
              hash: localHash,
            });
          }
          break;
        }
      }
    } catch (err) {
      this.onError?.(new Error(`Failed to parse control message: ${String(err)}`));
    }
  }

  private handleLocalDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Ignore updates applied from remote peers
    if (origin === this) {
      return;
    }

    this.pendingDocUpdates.push(update);
    this.setSyncState('saving');

    const now = this.clock();
    const elapsed = now - this.lastSentAt;

    // Leading edge: If last sent was >= batchWindowMs ago, flush immediately
    if (elapsed >= this.batchWindowMs) {
      this.flushBatch();
    } else if (!this.batchTimer) {
      const waitMs = this.batchWindowMs - elapsed;
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.flushBatch();
      }, waitMs);
    }
  };

  public queueAwarenessUpdate(update: Uint8Array): void {
    this.pendingAwarenessUpdate = update;
    const now = this.clock();
    if (now - this.lastSentAt >= this.batchWindowMs) {
      this.flushBatch();
    }
  }

  public flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingDocUpdates.length === 0 && this.pendingAwarenessUpdate.byteLength === 0) {
      return;
    }

    const mergedDoc =
      this.pendingDocUpdates.length > 0
        ? Y.mergeUpdates(this.pendingDocUpdates)
        : new Uint8Array(0);
    const awareness = this.pendingAwarenessUpdate;

    this.pendingDocUpdates = [];
    this.pendingAwarenessUpdate = new Uint8Array(0);

    const currentSeq = this.seq++;
    const frame: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: currentSeq,
      docUpdate: mergedDoc,
      awarenessUpdate: awareness,
    };

    if (mergedDoc.byteLength > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.pendingAcks.set(currentSeq, {
        docUpdate: mergedDoc,
        sentAt: this.clock(),
      });
    }

    this.lastSentAt = this.clock();
    this.sendRaw(encodeFrame(frame));
  }

  public sendControl(msg: ClientControlMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  private sendRaw(data: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(data);
  }

  public sendPing(): void {
    this.sendControl({
      t: 'ping',
      id: Math.floor(Math.random() * 100000),
      ts: this.clock(),
    });
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, CLIENT_PING_MS);
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private resetDeadTimer(): void {
    if (this.deadTimer) {
      clearTimeout(this.deadTimer);
    }
    this.deadTimer = setTimeout(() => {
      // 12s of total silence -> force close and reconnect
      this.ws?.terminate();
      this.handleClose({ code: WS_CLOSE_CODES.ABNORMAL } as WebSocket.CloseEvent);
    }, CLIENT_DEAD_MS);
  }

  private handleWsError = (err: unknown): void => {
    this.onError?.(err instanceof Error ? err : new Error('WebSocket error'));
  };

  private handleClose = (event: { code: number }): void => {
    this.stopPingTimer();
    if (this.deadTimer) {
      clearTimeout(this.deadTimer);
      this.deadTimer = null;
    }

    if (event.code === WS_CLOSE_CODES.KICKED) {
      this.setStatus('kicked');
      return;
    }

    this.pendingAcks.clear();

    if (this.isDestroyed || event.code === WS_CLOSE_CODES.NORMAL) {
      this.setStatus('disconnected');
      return;
    }

    // Attempt reconnect with backoff
    this.setStatus('reconnecting');
    this.reconnectAttempts++;
    const delay = calculateBackoff(this.reconnectAttempts);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  };

  public destroy(): void {
    this.isDestroyed = true;
    this.doc.off('update', this.handleLocalDocUpdate);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.deadTimer) clearTimeout(this.deadTimer);
    this.stopPingTimer();

    this.wakeManager?.destroy();
    this.wakeManager = null;
    this.statsStore.reset();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.sendControl({ t: 'leave' });
      }
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  public get connectionStatus(): ClientConnectionStatus {
    return this.status;
  }

  public get currentSyncState(): SyncState {
    return this.syncState;
  }

  public get unackedCount(): number {
    return this.pendingAcks.size;
  }

  public get stats(): ClientStats {
    return this.statsStore.getStats();
  }

  public get statsStoreInstance(): StatsStore {
    return this.statsStore;
  }

  public get wakeManagerInstance(): WakeManager | null {
    return this.wakeManager;
  }
}
