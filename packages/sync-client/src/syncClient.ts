import * as Y from 'yjs';
import type WebSocket from 'ws';
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
import { WakeManager } from './wakeManager.js';
import { probeAdmission } from './admissionProbe.js';
import { DelayLine } from './delayLine.js';
import {
  restoreFromStorage,
  persistToStorage,
  clearStorage,
} from './indexedDbStorage.js';

import type {
  ClientConnectionStatus,
  SyncState,
  SyncStorageOptions,
  SyncClientOptions,
} from './types.js';

// OPEN is 1 in browsers and `ws`. Not `WebSocket.OPEN`: in the browser bundle `ws` is a stub, so it's undefined.
const WS_OPEN = 1;

export type {
  ClientConnectionStatus,
  SyncState,
  SyncStorageOptions,
  SyncClientOptions,
};

export class SyncClient {
  public readonly doc: Y.Doc;
  private options: SyncClientOptions;
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
  private isOffline = false;
  private isDestroyed = false;

  private pendingDocUpdates: Uint8Array[] = [];
  private pendingAwarenessUpdate: Uint8Array = new Uint8Array(0);
  private pendingAcks = new Map<number, { docUpdate: Uint8Array; sentAt: number }>();
  private pendingCommands = new Map<string, { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();

  private statsStore: StatsStore;
  private readonly delayLine = new DelayLine();
  private wakeManager: WakeManager | null = null;

  private apiUrl?: string;
  private roomId?: string;
  private fetchFn?: typeof fetch;
  private storage?: SyncStorageOptions;
  private hasReceivedWelcome = false;
  private hasRestoredStorage = false;
  private storagePersistTimer: NodeJS.Timeout | null = null;

  private lastSentAt = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private deadTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public members: Member[] = [];
  public hostId: string | null = null;
  public room: RoomMetadata | null = null;
  public self: Member | null = null;

  constructor(options: SyncClientOptions) {
    this.options = options;
    this.url = options.url;
    this.token = options.token;
    this.doc = options.doc;
    this.apiUrl = options.apiUrl;
    this.roomId = options.roomId;
    this.fetchFn = options.fetchFn;
    this.storage = options.storage;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url, protocols) => new (globalThis.WebSocket as unknown as typeof WebSocket)(url, protocols));
    this.batchWindowMs = options.batchWindowMs ?? CLIENT_BATCH_WINDOW_MS;
    this.clock = options.clock ?? (() => Date.now());

    this.statsStore = new StatsStore(options.statsWindowSize ?? 60);
    this.delayLine.setDelay(options.latencyMs ?? 0);

    this.wakeManager = new WakeManager({
      probeTimeoutMs: options.wakeProbeTimeoutMs ?? WAKE_PROBE_MS,
      target: options.wakeTarget,
      onWakePing: () => {
        if (this.status === 'connected' && this.ws?.readyState === WS_OPEN) {
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
          this.killSocket();
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

    this.doc.on('update', this.handleLocalDocUpdate);
  }

  private setStatus(status: ClientConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange?.(status);
    }
  }

  private setSyncState(state: SyncState): void {
    if (this.syncState !== state) {
      this.syncState = state;
      this.options.onSyncStateChange?.(state);
    }
  }

  public async connect(): Promise<void> {
    if (this.isDestroyed || this.isOffline || this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Claim 'connecting' before the async restore so concurrent connect() calls (wake events, StrictMode) bail.
    this.hasReceivedWelcome = false;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    if (this.storage && !this.hasRestoredStorage) {
      try {
        await restoreFromStorage(
          this.doc,
          this.storage.roomId,
          this.storage.roomEpoch,
          this.storage.idbFactory
        );
      } catch (err) {
        this.options.onError?.(err instanceof Error ? err : new Error('Storage restore failed'));
      }
      this.hasRestoredStorage = true;
      if (this.isDestroyed || this.isOffline) return;
    }
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

    this.delayLine.run(() => {
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        this.handleBinaryFrame(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      } else if (typeof data === 'string') {
        this.handleControlMessage(data);
      }
    });
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
        if (frame.awarenessUpdate.byteLength > 0) {
          this.options.onAwarenessUpdate?.(frame.awarenessUpdate);
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
          this.hasReceivedWelcome = true;
          this.self = parsed.self;
          this.members = parsed.members;
          this.hostId = parsed.hostId;
          this.room = parsed.room;
          this.setStatus('connected');
          this.pendingAcks.clear();
          this.setSyncState('synced');
          this.options.onWelcome?.({
            self: parsed.self,
            room: parsed.room,
            chatSeq: parsed.chatSeq,
            eventSeq: parsed.eventSeq,
          });
          this.options.onRosterChange?.(parsed.members);
          this.options.onHostChange?.(parsed.hostId);
          break;
        }
        case 'pong': {
          const now = this.clock();
          const rtt = Math.max(0, now - parsed.ts);
          this.statsStore.recordRtt(rtt);
          this.wakeManager?.clearProbe();
          this.options.onStatsChange?.(this.statsStore.getStats());
          break;
        }
        case 'ack': {
          const pending = this.pendingAcks.get(parsed.seq);
          if (pending) {
            const ackLatency = Math.max(0, this.clock() - pending.sentAt);
            this.statsStore.recordAckLatency(ackLatency);
            this.pendingAcks.delete(parsed.seq);
            this.options.onStatsChange?.(this.statsStore.getStats());
          }
          if (this.pendingAcks.size === 0) {
            this.setSyncState('saved');
          }
          break;
        }
        case 'ok':
        case 'error': {
          const pending = parsed.rid ? this.pendingCommands.get(parsed.rid) : undefined;
          if (!pending || !parsed.rid) break;
          clearTimeout(pending.timer);
          this.pendingCommands.delete(parsed.rid);
          if (parsed.t === 'ok') pending.resolve();
          else pending.reject(new Error(parsed.code));
          break;
        }
        case 'token': {
          // Hourly refresh: reconnects must present the fresh token, and the app persists it for reloads.
          this.token = parsed.token;
          this.options.onToken?.(parsed.token);
          break;
        }
        case 'room.updated': {
          if (this.room) {
            this.room = {
              ...this.room,
              ...(parsed.settings.language ? { language: parsed.settings.language } : {}),
              ...(parsed.settings.locked !== undefined ? { locked: parsed.settings.locked } : {}),
              ...(parsed.settings.hasPasscode !== undefined ? { hasPasscode: parsed.settings.hasPasscode } : {}),
            };
          }
          this.options.onRoomUpdate?.(parsed.settings);
          break;
        }
        case 'event': {
          this.options.onEvent?.(parsed.event);
          break;
        }
        case 'chat.msg': {
          this.options.onChat?.(parsed.message);
          break;
        }
        case 'member.joined': {
          this.members = [...this.members.filter((m) => m.id !== parsed.member.id), parsed.member];
          this.options.onRosterChange?.(this.members);
          break;
        }
        case 'member.left': {
          this.members = this.members.filter((m) => m.id !== parsed.memberId);
          this.options.onRosterChange?.(this.members);
          break;
        }
        case 'throttled': {
          this.options.onThrottled?.(parsed.windowMs);
          break;
        }
        case 'host.changed': {
          this.hostId = parsed.hostId;
          this.options.onHostChange?.(parsed.hostId);
          break;
        }
        case 'checksum': {
          const localSv = Y.encodeStateVector(this.doc);
          const localText = this.doc.getText('codemirror').toString();
          const localHash = hashString(localText);

          const matched = areStateVectorsEqual(localSv, Buffer.from(parsed.sv, 'base64')) && localHash === parsed.hash;
          this.options.onChecksum?.({ hash: parsed.hash, matched });
          if (matched) {
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
      this.options.onError?.(new Error(`Failed to parse control message: ${String(err)}`));
    }
  }

  private handleLocalDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Ignore updates applied from remote peers or local storage restore
    if (origin === this || origin === 'storage') {
      return;
    }

    if (this.storage) {
      this.scheduleStoragePersist();
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

  private scheduleStoragePersist(): void {
    if (this.storagePersistTimer || !this.storage) return;
    const debounceMs = this.storage.debounceMs ?? 1000;
    this.storagePersistTimer = setTimeout(async () => {
      this.storagePersistTimer = null;
      if (this.storage && !this.isDestroyed) {
        try {
          await persistToStorage(
            this.doc,
            this.storage.roomId,
            this.storage.roomEpoch,
            this.storage.idbFactory
          );
        } catch (err) {
          this.options.onError?.(err instanceof Error ? err : new Error('Storage persist failed'));
        }
      }
    }, debounceMs);
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

    if (mergedDoc.byteLength > 0 && this.ws && this.ws.readyState === WS_OPEN) {
      this.pendingAcks.set(currentSeq, {
        docUpdate: mergedDoc,
        sentAt: this.clock(),
      });
    }

    this.lastSentAt = this.clock();
    this.sendRaw(encodeFrame(frame));
  }

  public sendControl(msg: ClientControlMessage): void {
    this.sendRaw(JSON.stringify(msg));
  }

  private sendRaw(data: Uint8Array | string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    this.delayLine.run(() => {
      if (ws.readyState === WS_OPEN) ws.send(data);
    });
  }

  /** Simulated latency (network lab): delays every frame in both directions, order preserved. */
  public setLatency(ms: number): void {
    this.delayLine.setDelay(ms);
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
      // 12s of total silence -> force close and reconnect. Browsers have no terminate(); killSocket falls back to close().
      if (this.ws) this.ws.onclose = null; // we run handleClose ourselves; don't let the async close event run it twice
      this.killSocket();
      this.handleClose({ code: WS_CLOSE_CODES.ABNORMAL } as WebSocket.CloseEvent);
    }, CLIENT_DEAD_MS);
  }

  private handleWsError = (err: unknown): void => {
    this.options.onError?.(err instanceof Error ? err : new Error('WebSocket error'));
  };

  private handleClose = async (event: { code: number }): Promise<void> => {
    this.delayLine.clear();
    this.stopPingTimer();
    if (this.deadTimer) {
      clearTimeout(this.deadTimer);
      this.deadTimer = null;
    }

    if (event.code === WS_CLOSE_CODES.KICKED) {
      this.setStatus('kicked');
      if (this.storage) await clearStorage(this.storage.roomId, this.storage.roomEpoch, this.storage.idbFactory);
      return;
    }

    if (event.code === WS_CLOSE_CODES.DOC_TOO_LARGE && this.storage) {
      await clearStorage(this.storage.roomId, this.storage.roomEpoch, this.storage.idbFactory);
    }

    this.pendingAcks.clear();

    if (this.isOffline) {
      this.setStatus('offline');
      return;
    }

    if (this.isDestroyed || event.code === WS_CLOSE_CODES.NORMAL) {
      this.setStatus('disconnected');
      return;
    }

    // Pre-welcome failure classification via Admission Probe
    if (!this.hasReceivedWelcome && this.apiUrl && this.roomId) {
      const isOnline = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true;
      if (isOnline) {
        const probe = await probeAdmission(this.apiUrl, this.roomId, this.token, this.fetchFn);
        if (probe.status === 'reauth') {
          this.setStatus('disconnected');
          this.options.onReauthRequired?.(probe.reason);
          return;
        }
        if (probe.status === 'banned') {
          this.setStatus('kicked');
          this.options.onBanned?.();
          if (this.storage) await clearStorage(this.storage.roomId, this.storage.roomEpoch, this.storage.idbFactory);
          return;
        }
        if (probe.status === 'not_found') {
          this.setStatus('disconnected');
          this.options.onRoomNotFound?.();
          return;
        }
        if (probe.status === 'locked') {
          this.setStatus('disconnected');
          this.options.onRoomLocked?.();
          return;
        }
      }
    }

    // Attempt reconnect with backoff
    this.setStatus('reconnecting');
    this.reconnectAttempts++;
    const delay = calculateBackoff(this.reconnectAttempts);
    this.options.onReconnectScheduled?.(this.reconnectAttempts, delay);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  };

  public async clearPersistence(): Promise<void> {
    if (this.storage) await clearStorage(this.storage.roomId, this.storage.roomEpoch, this.storage.idbFactory);
  }

  public command(cmd: ClientControlMessage & { rid: string }): Promise<void> {
    if (this.status !== 'connected' || !this.ws || this.ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error('offline'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(cmd.rid);
        reject(new Error('command_timeout'));
      }, 5000);
      this.pendingCommands.set(cmd.rid, { resolve, reject, timer });
      this.sendControl(cmd);
    });
  }

  public killSocket(): void {
    const wsAny = this.ws as unknown as { terminate?: () => void; close: () => void } | null;
    if (typeof wsAny?.terminate === 'function') wsAny.terminate();
    else wsAny?.close();
  }

  public setOffline(offline: boolean): void {
    if (this.isOffline === offline) return;
    this.isOffline = offline;

    if (offline) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.stopPingTimer();
      if (this.deadTimer) {
        clearTimeout(this.deadTimer);
        this.deadTimer = null;
      }
      this.killSocket();
      this.setStatus('offline');
    } else {
      this.reconnectAttempts = 0;
      void this.connect();
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.doc.off('update', this.handleLocalDocUpdate);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.deadTimer) clearTimeout(this.deadTimer);
    if (this.storagePersistTimer) clearTimeout(this.storagePersistTimer);
    this.stopPingTimer();
    this.delayLine.clear();

    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('destroyed'));
    }
    this.pendingCommands.clear();

    this.wakeManager?.destroy();
    this.wakeManager = null;
    this.statsStore.reset();

    if (this.ws) {
      if (this.ws.readyState === WS_OPEN) this.ws.send(JSON.stringify({ t: 'leave' }));
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  public get connectionStatus(): ClientConnectionStatus { return this.status; }
  public get currentSyncState(): SyncState { return this.syncState; }
  public get unackedCount(): number { return this.pendingAcks.size; }
  public get stats(): ClientStats { return this.statsStore.getStats(); }
  public get statsStoreInstance(): StatsStore { return this.statsStore; }
  public get wakeManagerInstance(): WakeManager | null { return this.wakeManager; }
}
