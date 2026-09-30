import {
  type AuditEvent,
  type ChatMessage,
  type ClientControlMessage,
  type Member,
} from '@tether/shared';
import { SyncClient as ProtocolSyncClient } from '@tether/sync-client';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import * as Y from 'yjs';
import { isLanguageId, STARTER_CODE } from '../languages';
import { createStore, shallowEqual, type WritableStore } from '../store';
import {
  CommandError,
  type ConnectionState,
  type LatencySample,
  type NetworkLab,
  type PresenceEntry,
  type PresenceSnapshot,
  type RoomState,
  type StatsSnapshot,
  type StatusSnapshot,
  type StormSnapshot,
  type SyncClient,
  type SyncCommand,
} from './types';

export interface ServerSyncOptions {
  roomId: string;
  memberId: string;
  token: string;
  epoch: string;
  wsUrl?: string;
  apiUrl?: string;
  seed?: boolean;
  onSeeded?: () => void;
  latencyMs?: number;
}

export class ServerSyncClient implements SyncClient {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText('codemirror');
  readonly scratchpadText = this.doc.getText('scratchpad');
  readonly awareness = new Awareness(this.doc);

  private readonly protocolClient: ProtocolSyncClient;
  private readonly eventListeners = new Set<(event: AuditEvent) => void>();
  private readonly chatListeners = new Set<(message: ChatMessage) => void>();
  private isPaused = false;
  private seedDone = false;

  readonly status = createStore<StatusSnapshot>(
    {
      connection: 'restoring',
      pending: 0,
      verifiedAt: null,
      checksum: null,
      attempt: 0,
      retryAt: null,
      throttled: false,
      unsavedAtClose: 0,
    },
    shallowEqual,
  );

  readonly stats = createStore<StatsSnapshot>(
    {
      rtt: null,
      rttP50: null,
      rttP95: null,
      ackP50: null,
      ackP95: null,
      samples: [],
      framesPerSec: 0,
      tokens: 10,
      latencyMs: 0,
    },
    shallowEqual,
  );

  readonly roster = createStore<readonly Member[]>([], shallowEqual);

  readonly room: WritableStore<RoomState>;

  readonly presence = createStore<PresenceSnapshot>(new Map(), (a, b) => {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      const bv = b.get(k);
      if (!bv || bv.length !== v.length) return false;
      for (let i = 0; i < v.length; i++) {
        const x = v[i]!;
        const y = bv[i]!;
        if (
          x.clientId !== y.clientId ||
          x.status !== y.status ||
          x.typing !== y.typing ||
          x.hasCursor !== y.hasCursor ||
          x.lastChange !== y.lastChange
        ) {
          return false;
        }
      }
    }
    return true;
  });

  readonly storm = createStore<StormSnapshot>(
    { running: false, bots: 0, endsAt: null, ops: 0, result: null },
    shallowEqual,
  );

  readonly lab: NetworkLab;

  constructor(private readonly options: ServerSyncOptions) {
    this.room = createStore<RoomState>(
      {
        room: {
          id: options.roomId,
          language: 'javascript',
          locked: false,
          hasPasscode: false,
          epoch: options.epoch,
        },
        hostId: null,
        selfId: options.memberId,
        eventSeq: 0,
        chatSeq: 0,
      },
      shallowEqual,
    );

    this.lab = {
      setLatency: () => {},
      setOffline: (offline: boolean) => {
        if (offline) {
          this.protocolClient.wakeManagerInstance?.destroy();
        }
      },
      killSocket: () => {
        this.status.set({ ...this.status.get(), connection: 'offline' });
      },
    };
    const wsBase = options.wsUrl || process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
    const wsUrl = `${wsBase.replace(/\/+$/, '')}/ws/rooms/${encodeURIComponent(options.roomId.toLowerCase())}`;
    const apiUrl = options.apiUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

    this.protocolClient = new ProtocolSyncClient({
      url: wsUrl,
      token: options.token,
      doc: this.doc,
      apiUrl,
      roomId: options.roomId,
      storage: {
        roomId: options.roomId,
        roomEpoch: options.epoch,
      },
      onStatusChange: (status) => {
        let conn: ConnectionState = 'offline';
        if (this.isPaused) {
          conn = 'paused';
        } else if (status === 'connected') {
          conn = 'online';
        } else if (status === 'connecting') {
          conn = 'connecting';
        } else if (status === 'reconnecting') {
          conn = 'reconnecting';
        } else if (status === 'kicked') {
          conn = 'kicked';
        } else if (status === 'disconnected') {
          conn = 'closed';
        }

        this.status.set({
          ...this.status.get(),
          connection: conn,
          pending: this.protocolClient.unackedCount,
        });
      },
      onSyncStateChange: (syncState) => {
        const cur = this.status.get();
        if (syncState === 'synced') {
          this.status.set({
            ...cur,
            verifiedAt: Date.now(),
            checksum: 'verified',
            pending: 0,
          });
        } else if (syncState === 'saving') {
          this.status.set({
            ...cur,
            pending: this.protocolClient.unackedCount,
          });
        }
      },
      onStatsChange: (clientStats) => {
        const s = this.stats.get();
        const now = Date.now();
        const newSample: LatencySample = {
          t: now,
          rtt: clientStats.rtt.latestMs,
          ack: clientStats.ackLatency.latestMs,
        };
        const samples = [...s.samples.slice(-59), newSample];

        this.stats.set({
          ...s,
          rtt: clientStats.rtt.latestMs,
          rttP50: clientStats.rtt.p50Ms,
          rttP95: clientStats.rtt.p95Ms,
          ackP50: clientStats.ackLatency.p50Ms,
          ackP95: clientStats.ackLatency.p95Ms,
          samples,
          latencyMs: clientStats.rtt.latestMs,
        });
      },
      onRosterChange: (members) => {
        this.roster.set(members);
      },
      onHostChange: (hostId) => {
        this.room.set({
          ...this.room.get(),
          hostId,
        });
      },
      onRoomUpdate: (settings) => {
        const current = this.room.get();
        this.room.set({
          ...current,
          room: {
            ...current.room,
            ...(settings.language ? { language: settings.language } : {}),
            ...(settings.locked !== undefined ? { locked: settings.locked } : {}),
            ...(settings.hasPasscode !== undefined ? { hasPasscode: settings.hasPasscode } : {}),
          },
        });
      },
      onWelcome: (welcome) => {
        this.room.set({
          room: welcome.room,
          hostId: this.protocolClient.hostId,
          selfId: welcome.self.id,
          eventSeq: welcome.eventSeq,
          chatSeq: welcome.chatSeq,
        });
        this.maybeSeedStarter(welcome.room.language);
      },
      onAwarenessUpdate: (awUpdate) => {
        applyAwarenessUpdate(this.awareness, awUpdate, this);
        this.syncPresenceFromAwareness();
      },
      onEvent: (event) => {
        for (const listener of this.eventListeners) {
          listener(event);
        }
      },
      onChat: (message) => {
        const cur = this.room.get();
        if (message.seq > cur.chatSeq) {
          this.room.set({ ...cur, chatSeq: message.seq });
        }
        for (const listener of this.chatListeners) {
          listener(message);
        }
      },
      onReauthRequired: () => {
        this.status.set({
          ...this.status.get(),
          connection: 'reauth',
        });
      },
      onBanned: () => {
        this.status.set({
          ...this.status.get(),
          connection: 'kicked',
        });
      },
    });

    // Bridge local awareness changes to protocol client
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === this) return;
      const changed = added.concat(updated, removed);
      const update = encodeAwarenessUpdate(this.awareness, changed);
      this.protocolClient.queueAwarenessUpdate(update);
      this.syncPresenceFromAwareness();
    });
  }

  private maybeSeedStarter(lang: string): void {
    if (!this.options.seed || this.seedDone) return;
    if (this.text.length === 0) {
      const template = isLanguageId(lang) ? STARTER_CODE[lang] : '';
      if (template) {
        this.text.insert(0, template);
      }
    }
    this.seedDone = true;
    this.options.onSeeded?.();
  }

  private syncPresenceFromAwareness(): void {
    const states = this.awareness.getStates();
    const map = new Map<string, PresenceEntry[]>();
    const now = Date.now();

    for (const [clientId, state] of states.entries()) {
      if (!state || typeof state !== 'object') continue;
      const s = state as Record<string, unknown>;
      const memberId = typeof s.memberId === 'string' ? s.memberId : '';
      if (!memberId) continue;

      const cursor = s.cursor as { anchor?: unknown; head?: unknown } | null | undefined;
      const entry: PresenceEntry = {
        clientId,
        memberId,
        typing: Boolean(s.typing),
        status: s.status === 'idle' || s.status === 'away' ? s.status : 'active',
        hasCursor: Boolean(cursor && cursor.anchor !== undefined),
        lastChange: now,
      };

      const list = map.get(memberId);
      if (list) list.push(entry);
      else map.set(memberId, [entry]);
    }

    this.presence.set(map);
  }

  onEvent(listener: (event: AuditEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onChat(listener: (message: ChatMessage) => void): () => void {
    this.chatListeners.add(listener);
    return () => this.chatListeners.delete(listener);
  }

  async sendChat(clientMsgId: string, text: string): Promise<void> {
    try {
      await this.protocolClient.command({
        t: 'chat.send',
        rid: clientMsgId,
        text,
      });
    } catch (err) {
      throw new CommandError((err as Error).message);
    }
  }

  async start(): Promise<void> {
    if (this.isPaused) return;
    await this.protocolClient.connect();
  }

  pause(): void {
    this.isPaused = true;
    this.status.set({ ...this.status.get(), connection: 'paused' });
  }

  resume(): void {
    this.isPaused = false;
    void this.protocolClient.connect();
  }

  async command(cmd: SyncCommand): Promise<void> {
    const rid = crypto.randomUUID();
    const fullCmd = { ...cmd, rid } as unknown as ClientControlMessage & { rid: string };
    try {
      await this.protocolClient.command(fullCmd);
    } catch (err) {
      throw new CommandError((err as Error).message);
    }
  }

  async leave(): Promise<void> {
    this.destroy();
  }

  destroy(): void {
    this.eventListeners.clear();
    this.chatListeners.clear();
    this.protocolClient.destroy();
    this.awareness.destroy();
    this.doc.destroy();
  }
}
