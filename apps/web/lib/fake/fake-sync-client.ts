import {
  calculateBackoff,
  CHECKSUM_QUIET_MS,
  CLIENT_BATCH_WINDOW_MS,
  CLIENT_PING_MS,
  HOST_GRACE_MS,
  hashString,
  PERSIST_FLUSH_MS,
  STORM_MAX_BOTS,
  STORM_MAX_SECONDS,
  THROTTLE_BURST,
  THROTTLE_RATE_PER_SEC,
  TokenBucket,
  type AuditEvent,
  type Member,
} from '@tether/shared';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';
import { STARTER_CODE, isLanguageId } from '../languages';
import { createStore, shallowEqual } from '../store';
import { percentile } from '../utils';
import { electHost } from '../sync/elect';
import {
  CommandError,
  type LatencySample,
  type PresenceEntry,
  type PresenceSnapshot,
  type RoomState,
  type StatsSnapshot,
  type StatusSnapshot,
  type StormSnapshot,
  type SyncClient,
  type SyncCommand,
} from '../sync/types';
import { hashPasscode, registry, type FakeRoom } from './registry';
import { runStorm } from './storm';

/**
 * ponytail: FakeSyncClient stands in for apps/server + packages/sync-client until M2/M3 land.
 * Tabs of the same browser act as peers over BroadcastChannel. The "server" state lives in localStorage and
 * the doc in IndexedDB. It honors the same contract (docs/04) so the UI can switch over without changes.
 * Known ceiling: no real admission and no cross-device sync.
 */
const REMOTE = Symbol('remote');
const HEARTBEAT_MS = 1000;
const SILENT_AFTER_MS = 3000;
const TYPING_MS = 1500;
const IDLE_MS = 60_000;
const EDIT_IDLE_MS = 5000;
const EDIT_MAX_MS = 30_000;
const SAMPLE_CAP = 60;

type Wire =
  | { k: 'update'; from: number; update: Uint8Array; to?: number }
  | { k: 'sv'; from: number; sv: Uint8Array }
  | { k: 'aw'; from: number; update: Uint8Array }
  | { k: 'aw-gone'; clients: number[] }
  | { k: 'hb'; memberId: string; status: Member['status']; hello?: boolean }
  | { k: 'bye'; memberId: string }
  | { k: 'room' }
  | { k: 'kick'; memberId: string }
  | { k: 'event'; event: AuditEvent };

interface Peer {
  member: Member;
  lastSeen: number;
}

export interface FakeSyncOptions {
  roomId: string;
  memberId: string;
  token: string;
  epoch: string;
  /** Creator's first open: seed the starter template once. */
  seed?: boolean;
  onSeeded?: () => void;
  latencyMs?: number;
}

export class FakeSyncClient implements SyncClient {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText('content');
  readonly scratchpadText = this.doc.getText('scratchpad');
  readonly awareness = new Awareness(this.doc);

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
  readonly stats = createStore<StatsSnapshot>({
    rtt: null,
    rttP50: null,
    rttP95: null,
    ackP50: null,
    ackP95: null,
    samples: [],
    framesPerSec: 0,
    tokens: THROTTLE_BURST,
    latencyMs: 0,
  });
  readonly roster = createStore<readonly Member[]>([]);
  readonly room: ReturnType<typeof createStore<RoomState>>;
  readonly presence = createStore<PresenceSnapshot>(new Map());
  readonly storm = createStore<StormSnapshot>({ running: false, bots: 0, endsAt: null, ops: 0, result: null });

  private readonly opts: FakeSyncOptions;
  private readonly channel: BroadcastChannel;
  private readonly idb: IndexeddbPersistence;
  private readonly eventListeners = new Set<(e: AuditEvent) => void>();
  private readonly peers = new Map<string, Peer>();
  private readonly bucket = new TokenBucket(THROTTLE_RATE_PER_SEC, THROTTLE_BURST);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private intervals: ReturnType<typeof setInterval>[] = [];
  private latencyMs: number;
  private offline = false;
  private paused = false;
  private connected = false;
  private destroyed = false;
  private lastDeliverAt = 0;
  private outbound: Uint8Array[] = [];
  private batchOpenUntil = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight = 0;
  private framesWindow: number[] = [];
  private rttSamples: number[] = [];
  private ackSamples: number[] = [];
  private samples: LatencySample[] = [];
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInputAt = Date.now();
  private presenceFrame = 0;
  private readonly clientChangedAt = new Map<number, number>();
  private edit = { inserted: 0, deleted: 0, from: Infinity, to: -Infinity, firstAt: 0, timer: null as ReturnType<typeof setTimeout> | null };
  private stopStorm: (() => void) | null = null;
  private botIds: string[] = [];

  constructor(opts: FakeSyncOptions) {
    this.opts = opts;
    this.latencyMs = opts.latencyMs ?? 0;
    const room = registry.get(opts.roomId);
    if (!room) throw new Error(`Room ${opts.roomId} not found`);
    this.room = createStore<RoomState>(this.roomState(room), (a, b) => JSON.stringify(a) === JSON.stringify(b));
    this.channel = new BroadcastChannel(`tether:room:${opts.roomId}`);
    this.idb = new IndexeddbPersistence(`tether:${opts.roomId}:${opts.epoch}`, this.doc);
    this.awareness.setLocalState({
      memberId: opts.memberId,
      cursor: null,
      highlight: null,
      typing: false,
      status: 'active',
    });
    this.stats.update((s) => ({ ...s, latencyMs: this.latencyMs }));
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    await this.idb.whenSynced; // restore-before-connect: local edits survive reloads and outages
    if (this.destroyed) return;
    this.channel.onmessage = (e: MessageEvent<Wire>) => this.receive(e.data);
    this.doc.on('update', this.onDocUpdate);
    this.text.observe(this.onTextChange);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.awareness.on('change', this.onAwarenessChange);
    this.intervals = [
      setInterval(() => this.heartbeat(), HEARTBEAT_MS),
      setInterval(() => this.ping(), CLIENT_PING_MS),
      setInterval(() => this.refreshActivity(), 5000),
    ];
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onInput, true);
    window.addEventListener('pointerdown', this.onInput, true);
    window.addEventListener('online', this.wake);
    window.addEventListener('pagehide', this.onPageHide);
    this.connect();
  }

  pause(): void {
    this.paused = true;
    this.disconnect('paused');
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.connect();
  }

  async leave(): Promise<void> {
    const self = this.selfMember();
    this.post({ k: 'bye', memberId: this.opts.memberId }, 0);
    const room = registry.get(this.opts.roomId);
    if (room && room.hostId === this.opts.memberId) {
      const next = electHost(this.roster.get(), this.opts.memberId);
      registry.mutate(this.opts.roomId, (r) => {
        r.hostId = next;
      });
      if (next) this.emit('host.changed', { from: self.name, to: this.nameOf(next), reason: 'handover-leave' });
    }
    this.emit('member.left', { reason: 'leave', memberId: self.id, name: self.name });
    registry.mutate(this.opts.roomId, (r) => {
      delete r.members[this.opts.memberId];
    });
    this.post({ k: 'room' }, 0);
    await this.idb.clearData();
    this.status.update((s) => ({ ...s, connection: 'closed' }));
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopStorm?.();
    this.post({ k: 'aw-gone', clients: [this.doc.clientID] }, 0);
    this.intervals.forEach(clearInterval);
    this.timers.forEach(clearTimeout);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.typingTimer) clearTimeout(this.typingTimer);
    if (this.edit.timer) clearTimeout(this.edit.timer);
    cancelAnimationFrame(this.presenceFrame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onInput, true);
    window.removeEventListener('pointerdown', this.onInput, true);
    window.removeEventListener('online', this.wake);
    window.removeEventListener('pagehide', this.onPageHide);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.off('change', this.onAwarenessChange);
    this.channel.close();
    this.awareness.destroy();
    void this.idb.destroy();
  }

  onEvent(listener: (e: AuditEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  readonly lab = {
    setLatency: (ms: number) => {
      this.latencyMs = Math.max(0, Math.min(2000, ms));
      this.stats.update((s) => ({ ...s, latencyMs: this.latencyMs }));
    },
    setOffline: (offline: boolean) => {
      this.offline = offline;
      if (offline) this.disconnect('offline');
      else this.connect();
    },
    killSocket: () => {
      if (!this.connected) return;
      this.disconnect('reconnecting');
      this.scheduleReconnect();
    },
  };

  // ---------------------------------------------------------------- connection

  private connect(): void {
    if (this.destroyed || this.paused || this.offline || this.connected) return;
    this.status.update((s) => ({ ...s, connection: s.attempt > 0 ? 'reconnecting' : 'connecting', retryAt: null }));
    this.later(() => this.handshake(), this.latencyMs * 2 + 60);
  }

  private handshake(): void {
    if (this.destroyed || this.paused || this.offline || this.connected) return;
    const room = registry.get(this.opts.roomId);
    if (!room) return this.close('closed');
    const me = room.members[this.opts.memberId];
    if (room.banned.includes(this.opts.memberId)) return this.close('kicked');
    if (!me || me.token !== this.opts.token) return this.close('reauth');

    this.connected = true;
    this.status.update((s) => ({ ...s, connection: 'online', attempt: 0, retryAt: null }));
    this.room.set(this.roomState(room));
    this.publishRoster();
    // SYNC_STEP1: ask peers for what we miss, and push everything we queued while away.
    this.post({ k: 'sv', from: this.doc.clientID, sv: Y.encodeStateVector(this.doc) });
    this.heartbeat(true);
    this.broadcastAwareness();
    if (this.outbound.length) this.flush();
    if (this.opts.seed && this.text.length === 0 && isLanguageId(room.language)) {
      this.opts.seed = false;
      this.text.insert(0, STARTER_CODE[room.language]);
      this.opts.onSeeded?.();
    }
    if (!sessionStorage.getItem(`tether:announced:${this.opts.memberId}`)) {
      sessionStorage.setItem(`tether:announced:${this.opts.memberId}`, '1');
      const isCreator = registry.events(this.opts.roomId).some(
        (e) => e.type === 'room.created' && e.actorMemberId === this.opts.memberId,
      );
      if (!isCreator) this.emit('member.joined', { memberId: this.opts.memberId });
    }
    this.scheduleVerify();
  }

  private disconnect(state: StatusSnapshot['connection']): void {
    this.connected = false;
    this.status.update((s) => ({ ...s, connection: state, verifiedAt: null }));
    this.publishRoster();
  }

  private close(state: 'kicked' | 'reauth' | 'closed'): void {
    const pending = this.status.get().pending + (this.outbound.length ? 1 : 0);
    this.connected = false;
    this.status.update((s) => ({ ...s, connection: state, unsavedAtClose: pending, verifiedAt: null }));
    if (state === 'kicked') {
      void this.idb.clearData(); // docs/04 close 4003: clear local copy. The in-memory doc stays for "Copy my version".
      this.intervals.forEach(clearInterval);
    }
  }

  private scheduleReconnect(): void {
    const attempt = this.status.get().attempt + 1;
    const delay = Math.max(400, calculateBackoff(attempt));
    this.status.update((s) => ({ ...s, connection: 'reconnecting', attempt, retryAt: Date.now() + delay }));
    this.later(() => this.connect(), delay);
  }

  private readonly wake = () => {
    // Wake fast path: retry now instead of waiting out the backoff.
    if (!this.connected && this.status.get().connection === 'reconnecting') this.connect();
  };

  private readonly onPageHide = () => {
    this.post({ k: 'aw-gone', clients: [this.doc.clientID] }, 0);
  };

  // ---------------------------------------------------------------- transport

  /** Ordered delivery with simulated one-way latency. Messages are dropped while disconnected, except doc frames, which queue. */
  private post(msg: Wire, delay = this.latencyMs): void {
    if (this.destroyed) return;
    const at = Math.max(this.lastDeliverAt, Date.now() + delay);
    this.lastDeliverAt = at;
    const send = () => {
      if (!this.destroyed) this.channel.postMessage(msg);
    };
    if (at <= Date.now()) send();
    else this.later(send, at - Date.now());
  }

  private receive(msg: Wire): void {
    if (!this.connected && msg.k !== 'room' && msg.k !== 'kick') return;
    const apply = () => this.handle(msg);
    // Inbound latency: symmetric with outbound.
    if (this.latencyMs > 0) this.later(apply, this.latencyMs);
    else apply();
  }

  private handle(msg: Wire): void {
    switch (msg.k) {
      case 'update':
        if (msg.to !== undefined && msg.to !== this.doc.clientID) return;
        Y.applyUpdate(this.doc, msg.update, REMOTE);
        return;
      case 'sv': {
        if (msg.from === this.doc.clientID) return;
        const diff = Y.encodeStateAsUpdate(this.doc, msg.sv);
        this.post({ k: 'update', from: this.doc.clientID, update: diff, to: msg.from });
        this.broadcastAwareness();
        return;
      }
      case 'aw':
        if (msg.from !== this.doc.clientID) applyAwarenessUpdate(this.awareness, msg.update, REMOTE);
        return;
      case 'aw-gone':
        removeAwarenessStates(this.awareness, msg.clients, REMOTE);
        return;
      case 'hb':
        this.onHeartbeat(msg.memberId, msg.status, msg.hello === true);
        return;
      case 'bye':
        this.peers.delete(msg.memberId);
        this.publishRoster();
        this.syncRoom();
        return;
      case 'room':
        this.syncRoom();
        return;
      case 'kick':
        if (msg.memberId === this.opts.memberId) this.close('kicked');
        else {
          this.peers.delete(msg.memberId);
          this.publishRoster();
        }
        return;
      case 'event':
        this.dispatch(msg.event);
        return;
    }
  }

  // ---------------------------------------------------------------- document

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    this.scheduleVerify();
    if (origin === REMOTE) return;
    this.outbound.push(update);
    this.maybeFlush();
  };

  /** Leading-edge batcher (docs/03): the first update goes out now, and updates within the window merge into one frame. */
  private maybeFlush(): void {
    if (!this.connected) {
      this.status.update((s) => ({ ...s, pending: this.inflight + 1 }));
      return;
    }
    const now = Date.now();
    if (now >= this.batchOpenUntil && this.bucket.take(1, now)) {
      this.batchOpenUntil = now + CLIENT_BATCH_WINDOW_MS;
      this.flush();
      return;
    }
    if (this.flushTimer) return;
    const at = Math.max(this.batchOpenUntil, this.bucket.nextAvailableAt(1, now));
    this.status.update((s) => ({ ...s, throttled: at - now > CLIENT_BATCH_WINDOW_MS }));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.connected) return;
      this.bucket.take(1);
      this.batchOpenUntil = Date.now() + CLIENT_BATCH_WINDOW_MS;
      this.status.update((s) => ({ ...s, throttled: false }));
      this.flush();
    }, at - now);
  }

  private flush(): void {
    if (!this.outbound.length) return;
    const update = Y.mergeUpdates(this.outbound);
    this.outbound = [];
    const sentAt = Date.now();
    this.inflight += 1;
    this.framesWindow.push(sentAt);
    this.status.update((s) => ({ ...s, pending: this.inflight }));
    this.post({ k: 'update', from: this.doc.clientID, update });
    // Ack = committed to the database: one-way trip + persistence flush + one-way trip back.
    this.later(() => {
      this.inflight = Math.max(0, this.inflight - 1);
      this.status.update((s) => ({ ...s, pending: this.inflight + (this.outbound.length ? 1 : 0) }));
      this.recordSample(null, Date.now() - sentAt);
      this.scheduleVerify();
    }, this.latencyMs * 2 + PERSIST_FLUSH_MS * Math.random() + 8);
  }

  private readonly onTextChange = (event: Y.YTextEvent) => {
    const origin = event.transaction.origin;
    if (origin === REMOTE || typeof origin === 'string') return; // remote or bot
    let index = 0;
    for (const op of event.delta) {
      if (op.retain) index += op.retain;
      if (typeof op.insert === 'string') {
        this.edit.inserted += op.insert.length;
        this.trackRange(index, index + op.insert.length);
        index += op.insert.length;
      }
      if (op.delete) {
        this.edit.deleted += op.delete;
        this.trackRange(index, index);
      }
    }
    this.markTyping();
    const now = Date.now();
    if (!this.edit.firstAt) this.edit.firstAt = now;
    if (this.edit.timer) clearTimeout(this.edit.timer);
    const wait = Math.min(EDIT_IDLE_MS, this.edit.firstAt + EDIT_MAX_MS - now);
    this.edit.timer = setTimeout(() => this.flushEditSummary(), Math.max(0, wait));
  };

  private trackRange(from: number, to: number): void {
    this.edit.from = Math.min(this.edit.from, from);
    this.edit.to = Math.max(this.edit.to, to);
  }

  /** Coalesced edit summary: one feed row per member per 5 s of editing, capped at 30 s (docs/06). */
  private flushEditSummary(): void {
    const { inserted, deleted, from, to } = this.edit;
    this.edit = { inserted: 0, deleted: 0, from: Infinity, to: -Infinity, firstAt: 0, timer: null };
    if (!inserted && !deleted) return;
    const content = this.text.toString();
    const lineOf = (pos: number) => content.slice(0, Math.min(pos, content.length)).split('\n').length;
    this.emit('edit.summary', { inserted, deleted, lines: [lineOf(from), lineOf(Math.max(from, to))] });
  }

  private scheduleVerify(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.status.get().verifiedAt !== null) this.status.update((s) => ({ ...s, verifiedAt: null }));
    this.quietTimer = setTimeout(() => {
      const s = this.status.get();
      // Never "Verified" while pending > 0 or offline (docs/07 SyncBadge).
      if (!this.connected || s.pending > 0 || this.outbound.length) return this.scheduleVerify();
      this.status.update((x) => ({ ...x, verifiedAt: Date.now(), checksum: hashString(this.text.toString()) }));
    }, CHECKSUM_QUIET_MS);
  }

  // ---------------------------------------------------------------- presence

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === REMOTE || !this.connected) return;
    const changed = added.concat(updated, removed);
    this.post({ k: 'aw', from: this.doc.clientID, update: encodeAwarenessUpdate(this.awareness, changed) });
  };

  private readonly onAwarenessChange = ({ added, updated }: { added: number[]; updated: number[] }) => {
    const now = Date.now();
    added.concat(updated).forEach((id) => this.clientChangedAt.set(id, now));
    // Coalesce to one presence snapshot per animation frame (docs/07).
    if (this.presenceFrame) return;
    this.presenceFrame = requestAnimationFrame(() => {
      this.presenceFrame = 0;
      this.publishPresence();
    });
  };

  private publishPresence(): void {
    const byMember = new Map<string, PresenceEntry[]>();
    this.awareness.getStates().forEach((state, clientId) => {
      const memberId = typeof state.memberId === 'string' ? state.memberId : null;
      if (!memberId) return;
      const entry: PresenceEntry = {
        clientId,
        memberId,
        typing: state.typing === true,
        status: state.status === 'idle' || state.status === 'away' ? state.status : 'active',
        hasCursor: state.cursor != null,
        lastChange: this.clientChangedAt.get(clientId) ?? 0,
      };
      const list = byMember.get(memberId) ?? [];
      list.push(entry);
      byMember.set(memberId, list);
    });
    byMember.forEach((list) => list.sort((a, b) => b.lastChange - a.lastChange));
    this.presence.set(byMember);
  }

  private broadcastAwareness(): void {
    this.post({
      k: 'aw',
      from: this.doc.clientID,
      update: encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
    });
  }

  private markTyping(): void {
    this.lastInputAt = Date.now();
    if (!this.awareness.getLocalState()?.typing) this.awareness.setLocalStateField('typing', true);
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.awareness.setLocalStateField('typing', false), TYPING_MS);
  }

  private readonly onInput = () => {
    this.lastInputAt = Date.now();
    if (this.awareness.getLocalState()?.status === 'idle') this.setLocalStatus('active');
  };

  private readonly onVisibility = () => {
    this.setLocalStatus(document.hidden ? 'away' : 'active');
    if (!document.hidden) this.wake();
  };

  private refreshActivity(): void {
    if (document.hidden) return;
    if (Date.now() - this.lastInputAt > IDLE_MS) this.setLocalStatus('idle');
  }

  private setLocalStatus(status: 'active' | 'idle' | 'away'): void {
    if (this.awareness.getLocalState()?.status !== status) this.awareness.setLocalStateField('status', status);
  }

  // ---------------------------------------------------------------- roster & room

  private heartbeat(hello = false): void {
    if (!this.connected) return;
    const status = (this.awareness.getLocalState()?.status as Member['status'] | undefined) ?? 'active';
    this.post({ k: 'hb', memberId: this.opts.memberId, status, hello });
    if (this.storm.get().running) this.botIds.forEach((id) => this.post({ k: 'hb', memberId: id, status: 'active' }));
    this.sweep();
  }

  private onHeartbeat(memberId: string, status: Member['status'], hello: boolean): void {
    if (memberId === this.opts.memberId) return;
    const known = this.peers.get(memberId);
    const room = registry.get(this.opts.roomId);
    const record = room?.members[memberId];
    if (!record) return;
    const member: Member = {
      id: memberId,
      name: record.name,
      colorIndex: record.colorIndex,
      joinedAt: record.joinedAt,
      isBot: record.isBot,
      isHost: room?.hostId === memberId,
      status,
    };
    this.peers.set(memberId, { member, lastSeen: Date.now() });
    if (hello || !known) this.heartbeat();
    if (!known || known.member.status !== status) this.publishRoster();
  }

  /** Marks silent peers `reconnecting`, then drops them after the host grace window (docs/05). */
  private sweep(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      const silent = now - peer.lastSeen;
      if (silent > SILENT_AFTER_MS + HOST_GRACE_MS) {
        this.peers.delete(id);
        changed = true;
        this.onTimeout(peer.member);
      } else if (silent > SILENT_AFTER_MS && peer.member.status !== 'reconnecting') {
        peer.member = { ...peer.member, status: 'reconnecting' };
        changed = true;
      }
    }
    if (changed) this.publishRoster();
  }

  private onTimeout(gone: Member): void {
    const room = registry.get(this.opts.roomId);
    if (!room || gone.isBot) return;
    if (room.hostId === gone.id) {
      const next = electHost(this.roster.get(), gone.id);
      // Every tab computes the same winner, and only the winner writes and announces.
      if (next !== this.opts.memberId) return;
      registry.mutate(this.opts.roomId, (r) => {
        r.hostId = next;
      });
      this.emit('member.left', { reason: 'timeout', memberId: gone.id, name: gone.name });
      this.emit('host.changed', { from: gone.name, to: this.selfMember().name, reason: 'handover-timeout' });
      this.post({ k: 'room' });
      this.syncRoom();
    } else if (room.hostId === this.opts.memberId) {
      this.emit('member.left', { reason: 'timeout', memberId: gone.id, name: gone.name });
    }
  }

  private selfMember(): Member {
    const room = registry.get(this.opts.roomId);
    const rec = room?.members[this.opts.memberId];
    return {
      id: this.opts.memberId,
      name: rec?.name ?? 'You',
      colorIndex: rec?.colorIndex ?? 0,
      joinedAt: rec?.joinedAt ?? new Date().toISOString(),
      isBot: false,
      isHost: room?.hostId === this.opts.memberId,
      status: this.connected
        ? ((this.awareness.getLocalState()?.status as Member['status'] | undefined) ?? 'active')
        : 'reconnecting',
    };
  }

  private nameOf(memberId: string): string {
    return registry.get(this.opts.roomId)?.members[memberId]?.name ?? 'someone';
  }

  private publishRoster(): void {
    const hostId = registry.get(this.opts.roomId)?.hostId ?? null;
    const list = [this.selfMember(), ...[...this.peers.values()].map((p) => p.member)].map((m) =>
      m.isHost === (m.id === hostId) ? m : { ...m, isHost: m.id === hostId },
    );
    list.sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.joinedAt.localeCompare(b.joinedAt));
    const prev = this.roster.get();
    const same = prev.length === list.length && prev.every((m, i) => shallowEqual(m, list[i]!));
    if (!same) this.roster.set(list);
  }

  private syncRoom(): void {
    const room = registry.get(this.opts.roomId);
    if (!room) return this.close('closed');
    if (!room.members[this.opts.memberId] && this.status.get().connection !== 'kicked') {
      if (room.banned.includes(this.opts.memberId)) return this.close('kicked');
    }
    this.room.set(this.roomState(room));
    this.publishRoster();
  }

  private roomState(room: FakeRoom): RoomState {
    return {
      room: {
        id: room.id,
        language: room.language,
        locked: room.locked,
        hasPasscode: room.passcodeHash !== null,
        epoch: room.epoch,
      },
      hostId: room.hostId,
      selfId: this.opts.memberId,
      eventSeq: room.eventSeq,
    };
  }

  // ---------------------------------------------------------------- events

  /** Append to the audit log ("commit"), then push to everyone, including self. */
  private emit(type: string, payload: Record<string, unknown>, actor: { id: string; name: string } | null = null): void {
    const who = actor ?? { id: this.opts.memberId, name: this.selfMember().name };
    const event = registry.appendEvent(this.opts.roomId, type, who, payload);
    if (!event) return;
    this.dispatch(event);
    this.post({ k: 'event', event });
    this.room.update((r) => ({ ...r, eventSeq: event.seq }));
  }

  private dispatch(event: AuditEvent): void {
    this.eventListeners.forEach((l) => l(event));
  }

  // ---------------------------------------------------------------- commands

  async command(cmd: SyncCommand): Promise<void> {
    if (!this.connected) throw new CommandError('offline');
    await new Promise((r) => this.later(() => r(undefined), this.latencyMs * 2 + 40));
    const room = registry.get(this.opts.roomId);
    if (!room) throw new CommandError('not_found');
    if (room.hostId !== this.opts.memberId) throw new CommandError('forbidden');

    switch (cmd.t) {
      case 'host.kick': {
        if (room.banned.includes(cmd.memberId)) return; // idempotent by target state
        const name = room.members[cmd.memberId]?.name ?? 'member';
        registry.mutate(room.id, (r) => {
          r.banned.push(cmd.memberId);
          delete r.members[cmd.memberId];
        });
        this.post({ k: 'kick', memberId: cmd.memberId });
        this.peers.delete(cmd.memberId);
        this.emit('member.left', { reason: 'kicked', memberId: cmd.memberId, name });
        break;
      }
      case 'host.lock':
        if (room.locked === cmd.locked) return;
        registry.mutate(room.id, (r) => {
          r.locked = cmd.locked;
        });
        this.emit(cmd.locked ? 'room.locked' : 'room.unlocked', {});
        break;
      case 'host.passcode': {
        const hash = cmd.passcode ? await hashPasscode(room.id, cmd.passcode) : null;
        if (hash === room.passcodeHash) return;
        const action = hash === null ? 'cleared' : room.passcodeHash === null ? 'set' : 'changed';
        registry.mutate(room.id, (r) => {
          r.passcodeHash = hash;
          r.passcodeVersion += 1;
        });
        this.emit('room.passcode', { action });
        break;
      }
      case 'host.transfer': {
        if (!this.peers.has(cmd.memberId) || cmd.memberId === this.opts.memberId) {
          throw new CommandError('not_active');
        }
        registry.mutate(room.id, (r) => {
          r.hostId = cmd.memberId;
        });
        this.emit('host.changed', { from: this.selfMember().name, to: this.nameOf(cmd.memberId), reason: 'manual' });
        break;
      }
      case 'room.language':
        if (room.language === cmd.language) return;
        registry.mutate(room.id, (r) => {
          r.language = cmd.language;
        });
        this.emit('room.language', { from: room.language, to: cmd.language });
        break;
      case 'demo.storm':
        if (this.storm.get().running) throw new CommandError('storm_running');
        this.startStorm(
          Math.min(STORM_MAX_BOTS, Math.max(1, cmd.bots)),
          Math.min(STORM_MAX_SECONDS, Math.max(10, cmd.seconds)),
          cmd.faults,
        );
        break;
    }
    this.post({ k: 'room' });
    this.syncRoom();
  }

  private startStorm(bots: number, seconds: number, faults: boolean): void {
    const room = registry.get(this.opts.roomId);
    if (!room) return;
    this.botIds = Array.from({ length: bots }, (_, i) => `bot_${this.doc.clientID}_${i}`);
    registry.mutate(room.id, (r) => {
      this.botIds.forEach((id, i) => {
        r.members[id] = {
          name: `Bot ${i + 1}`,
          colorIndex: (r.nextColor + i) % 8,
          joinedAt: new Date().toISOString(),
          isBot: true,
          token: '',
        };
      });
    });
    this.emit('demo.storm', { bots, seconds, faults });
    this.storm.set({ running: true, bots, endsAt: Date.now() + seconds * 1000, ops: 0, result: null });
    this.post({ k: 'room' });
    this.heartbeat();
    this.stopStorm = runStorm({
      doc: this.doc,
      awareness: this.awareness,
      botIds: this.botIds,
      seconds,
      faults,
      onOps: (ops) => this.storm.update((s) => ({ ...s, ops })),
      onDone: (result) => {
        this.stopStorm = null;
        registry.mutate(room.id, (r) => this.botIds.forEach((id) => delete r.members[id]));
        this.botIds.forEach((id) => {
          this.peers.delete(id);
          this.post({ k: 'bye', memberId: id });
        });
        this.botIds = [];
        this.storm.set({ running: false, bots: 0, endsAt: null, ops: result.ops, result });
        this.publishRoster();
      },
    });
    // Bots appear in the local roster immediately. Other tabs learn about them from heartbeats.
    this.botIds.forEach((id) => this.onHeartbeat(id, 'active', false));
  }

  // ---------------------------------------------------------------- stats

  private ping(): void {
    if (!this.connected) return;
    const sentAt = performance.now();
    // Round trip through the simulated server hop (latency each way) plus real event-loop delay.
    this.later(() => this.recordSample(performance.now() - sentAt, null), this.latencyMs * 2 + 2);
  }

  private recordSample(rtt: number | null, ack: number | null): void {
    const now = Date.now();
    if (rtt !== null) this.rttSamples = [...this.rttSamples, rtt].slice(-SAMPLE_CAP);
    if (ack !== null) this.ackSamples = [...this.ackSamples, ack].slice(-SAMPLE_CAP);
    this.samples = [...this.samples, { t: now, rtt, ack }].slice(-SAMPLE_CAP);
    this.framesWindow = this.framesWindow.filter((t) => now - t < 1000);
    const round = (v: number | null) => (v === null ? null : Math.round(v));
    this.stats.set({
      rtt: rtt !== null ? Math.round(rtt) : this.stats.get().rtt,
      rttP50: round(percentile(this.rttSamples, 50)),
      rttP95: round(percentile(this.rttSamples, 95)),
      ackP50: round(percentile(this.ackSamples, 50)),
      ackP95: round(percentile(this.ackSamples, 95)),
      samples: this.samples,
      framesPerSec: this.framesWindow.length,
      tokens: Math.floor(this.bucket.peek(now)),
      latencyMs: this.latencyMs,
    });
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}
