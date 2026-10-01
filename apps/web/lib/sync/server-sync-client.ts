import {
  type AuditEvent,
  type ChatCodeRef,
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
  /** Hourly token refresh from the server: persist it so a reload rejoins without the gate. */
  onToken?: (token: string) => void;
}

const TYPING_MS = 1500;
/** After a storm ends, this browser's replica must match a server checksum within this window to count as converged. */
const STORM_VERIFY_MS = 5000;

const withHost = (members: readonly Member[], hostId: string | null): Member[] =>
  members.map((m) => (m.isHost === (m.id === hostId) ? m : { ...m, isHost: m.id === hostId }));

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
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupStatusTracking?: () => void;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private framesTimer: ReturnType<typeof setInterval> | null = null;
  private inboundFrames = 0;
  /** Storm finished server-side; waiting for this replica's checksum to match before reporting convergence. */
  private stormVerify: { serverConverged: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly textObserver = (event: Y.YTextEvent) => {
    // Only our own edits mean we are typing; remote edits must not flip our presence.
    if (event.transaction.local) this.markTyping();
    const currentStorm = this.storm.get();
    if (currentStorm.running) {
      this.storm.set({
        ...currentStorm,
        ops: currentStorm.ops + 1,
      });
    }
  };

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
      setLatency: (ms: number) => {
        this.protocolClient.setLatency(ms);
        this.stats.set({ ...this.stats.get(), latencyMs: ms });
      },
      setOffline: (offline: boolean) => {
        this.protocolClient.setOffline(offline);
      },
      killSocket: () => {
        this.protocolClient.killSocket();
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
      latencyMs: options.latencyMs ?? 0,
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

        const cur = this.status.get();
        this.status.set({
          ...cur,
          connection: conn,
          pending: this.protocolClient.unackedCount,
          // Only a server checksum match (onChecksum) marks the replica verified; a fresh connection starts unverified.
          verifiedAt: conn === 'online' && cur.connection === 'online' ? cur.verifiedAt : null,
          ...(conn === 'online' ? { attempt: 0, retryAt: null } : {}),
        });
      },
      onReconnectScheduled: (attempt, delayMs) => {
        this.status.set({ ...this.status.get(), attempt, retryAt: Date.now() + delayMs });
      },
      onSyncStateChange: (syncState) => {
        const cur = this.status.get();
        const pending = this.protocolClient.unackedCount;
        if (syncState === 'saving') {
          // New local edits: the last verification no longer covers the document.
          this.status.set({ ...cur, pending, verifiedAt: null });
        } else if (syncState === 'mismatch') {
          this.status.set({ ...cur, pending, verifiedAt: null, checksum: null });
        } else {
          this.status.set({ ...cur, pending });
        }
      },
      onChecksum: ({ hash, matched }) => {
        const cur = this.status.get();
        this.status.set(
          matched
            ? { ...cur, verifiedAt: Date.now(), checksum: hash, pending: this.protocolClient.unackedCount }
            : { ...cur, verifiedAt: null, checksum: null },
        );
        if (matched && this.stormVerify) this.finishStormVerify(this.stormVerify.serverConverged);
      },
      onThrottled: (windowMs) => {
        this.status.set({ ...this.status.get(), throttled: true });
        if (this.throttleTimer) clearTimeout(this.throttleTimer);
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          this.status.set({ ...this.status.get(), throttled: false });
        }, windowMs);
      },
      onToken: (token) => options.onToken?.(token),
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
        });
      },
      onRosterChange: (members) => {
        this.roster.set(withHost(members, this.room.get().hostId));
      },
      onHostChange: (hostId) => {
        this.room.set({
          ...this.room.get(),
          hostId,
        });
        // Server stamps isHost once at join; keep the roster in step with live host changes.
        this.roster.set(withHost(this.roster.get(), hostId));
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
        if (event.type === 'demo.storm') {
          const payload = (event.payload ?? {}) as { bots?: number; seconds?: number; faults?: boolean };
          const bots = payload.bots ?? 0;
          const seconds = payload.seconds ?? 0;
          this.storm.set({
            running: true,
            bots,
            endsAt: Date.now() + seconds * 1000,
            ops: 0,
            result: null,
          });
        } else if (event.type === 'demo.storm_completed') {
          this.startStormVerify(event.payload);
        }

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

    this.stats.set({ ...this.stats.get(), latencyMs: options.latencyMs ?? 0 });

    // Frames/s: remote updates actually applied to this replica, sampled once a second.
    this.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === this.protocolClient) this.inboundFrames++;
    });
    this.framesTimer = setInterval(() => {
      this.stats.set({ ...this.stats.get(), framesPerSec: this.inboundFrames });
      this.inboundFrames = 0;
    }, 1000);

    // Bridge local awareness changes to protocol client
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === this) return;
      const changed = added.concat(updated, removed);
      const update = encodeAwarenessUpdate(this.awareness, changed);
      this.protocolClient.queueAwarenessUpdate(update);
      this.syncPresenceFromAwareness();
    });

    // Initialize local awareness state
    this.awareness.setLocalState({
      memberId: options.memberId,
      cursor: null,
      highlight: null,
      typing: false,
      status: 'active',
    });

    // Observe text edits to update typing indicator
    this.text.observe(this.textObserver);
    this.setupStatusTracking();
  }

  private markTyping(): void {
    if (!this.awareness.getLocalState()?.typing) {
      this.awareness.setLocalStateField('typing', true);
    }
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
    }
    this.typingTimer = setTimeout(() => {
      this.awareness.setLocalStateField('typing', false);
    }, TYPING_MS);
  }

  private setupStatusTracking(): void {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        this.awareness.setLocalStateField('status', 'away');
      } else {
        this.awareness.setLocalStateField('status', 'active');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    this.cleanupStatusTracking = () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
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

  async sendChat(clientMsgId: string, text: string, ref?: ChatCodeRef): Promise<void> {
    try {
      await this.protocolClient.command({
        t: 'chat.send',
        rid: clientMsgId,
        text,
        ...(ref ? { ref } : {}),
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
      if (cmd.t === 'demo.storm_stop') {
        const cur = this.storm.get();
        if (cur.running) {
          this.storm.set({
            ...cur,
            running: false,
            bots: 0,
            endsAt: null,
          });
        }
      }
    } catch (err) {
      throw new CommandError((err as Error).message);
    }
  }

  async leave(): Promise<void> {
    this.destroy();
  }

  /** Server reports bot replicas vs its own; convergence also needs this browser's replica to match a server checksum. */
  private startStormVerify(raw: unknown): void {
    const payload = (raw ?? {}) as { bots?: number; seconds?: number; durationMs?: number; ops?: number; converged?: boolean; checksum?: string };
    const current = this.storm.get();
    const ops = payload.ops ?? current.ops;
    this.storm.set({
      running: false,
      bots: 0,
      endsAt: null,
      ops,
      result: {
        bots: payload.bots ?? current.bots,
        durationMs: payload.durationMs ?? (payload.seconds ?? 0) * 1000,
        ops,
        converged: null,
        checksum: payload.checksum ?? '--------',
      },
    });
    if (this.stormVerify) clearTimeout(this.stormVerify.timer);
    this.stormVerify = {
      serverConverged: payload.converged === true,
      timer: setTimeout(() => this.finishStormVerify(false), STORM_VERIFY_MS),
    };
  }

  private finishStormVerify(converged: boolean): void {
    if (!this.stormVerify) return;
    clearTimeout(this.stormVerify.timer);
    this.stormVerify = null;
    const s = this.storm.get();
    if (!s.result) return;
    const checksum = this.status.get().checksum ?? s.result.checksum;
    this.storm.set({ ...s, result: { ...s.result, converged, checksum } });
  }

  destroy(): void {
    if (this.framesTimer) clearInterval(this.framesTimer);
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    if (this.stormVerify) clearTimeout(this.stormVerify.timer);
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    this.cleanupStatusTracking?.();
    this.text.unobserve(this.textObserver);
    this.eventListeners.clear();
    this.chatListeners.clear();
    this.protocolClient.destroy();
    this.awareness.destroy();
    this.doc.destroy();
  }
}
