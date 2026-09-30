import type { AuditEvent, ChatMessage, ClientControlMessage, Member, RoomMetadata } from '@tether/shared';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { ReadableStore } from '../store';

/**
 * The contract the UI renders against (docs/07 render strategy). The real SyncClient in
 * ServerSyncClient implements this on top of packages/sync-client.
 * The document never enters React state: CodeMirror owns rendering, Yjs owns data, and components read these small stores.
 */
export type ConnectionState =
  | 'restoring'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'paused'
  | 'kicked'
  | 'reauth'
  | 'closed';

export interface StatusSnapshot {
  connection: ConnectionState;
  /** Local update frames sent or queued but not yet acked (committed). */
  pending: number;
  /** Last time client + server state was verified identical (P1). Null while syncing. */
  verifiedAt: number | null;
  checksum: string | null;
  attempt: number;
  retryAt: number | null;
  throttled: boolean;
  /** Pending count at the moment of a kick: "N changes were not saved". */
  unsavedAtClose: number;
}

export interface LatencySample {
  t: number;
  rtt: number | null;
  ack: number | null;
}

export interface StatsSnapshot {
  rtt: number | null;
  rttP50: number | null;
  rttP95: number | null;
  ackP50: number | null;
  ackP95: number | null;
  samples: readonly LatencySample[];
  framesPerSec: number;
  latencyMs: number;
}

export interface RoomState {
  room: RoomMetadata;
  hostId: string | null;
  selfId: string;
  /** Latest committed feed seq (welcome.eventSeq). */
  eventSeq: number;
  /** Latest committed chat seq (welcome.chatSeq, then each chat.msg). Drives chat gap-fill. */
  chatSeq: number;
}

export interface PresenceEntry {
  clientId: number;
  memberId: string;
  typing: boolean;
  status: 'active' | 'idle' | 'away';
  hasCursor: boolean;
  /** Local receive time of this client's last awareness change. Used for "follow the most recently active tab". */
  lastChange: number;
}
/** memberId -> that member's awareness clients, most recently active first. */
export type PresenceSnapshot = ReadonlyMap<string, readonly PresenceEntry[]>;

export interface StormResult {
  bots: number;
  ops: number;
  durationMs: number;
  /** null while this replica is still being verified against the server checksum. */
  converged: boolean | null;
  checksum: string;
}
export interface StormSnapshot {
  running: boolean;
  bots: number;
  endsAt: number | null;
  ops: number;
  result: StormResult | null;
}

// chat.send carries a rid but is not a host command: it goes through sendChat().
type CommandMessage = Exclude<Extract<ClientControlMessage, { rid: string }>, { t: 'chat.send' }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type SyncCommand = DistributiveOmit<CommandMessage, 'rid'>;

export class CommandError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'CommandError';
  }
}

export interface NetworkLab {
  setLatency(ms: number): void;
  setOffline(offline: boolean): void;
  killSocket(): void;
}

export interface SyncClient {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  readonly scratchpadText: Y.Text;
  readonly awareness: Awareness;
  readonly status: ReadableStore<StatusSnapshot>;
  readonly stats: ReadableStore<StatsSnapshot>;
  readonly roster: ReadableStore<readonly Member[]>;
  readonly room: ReadableStore<RoomState>;
  readonly presence: ReadableStore<PresenceSnapshot>;
  readonly storm: ReadableStore<StormSnapshot>;
  readonly lab: NetworkLab;
  onEvent(listener: (event: AuditEvent) => void): () => void;
  /** Live chat pushes (ADR-017), including your own confirmed messages. */
  onChat(listener: (message: ChatMessage) => void): () => void;
  /**
   * Send a chat message. `clientMsgId` (a UUID) makes resends idempotent.
   * Resolves once the server stored it. Rejects with CommandError ('offline', 'rate_limited', ...).
   */
  sendChat(clientMsgId: string, text: string): Promise<void>;
  /** Restore the local copy (IndexedDB) first, then connect. */
  start(): Promise<void>;
  /** Stop connecting without losing state (small-screen gate). */
  pause(): void;
  resume(): void;
  /** Host command with rid. Resolves on `ok`, rejects with CommandError on `error`. */
  command(cmd: SyncCommand): Promise<void>;
  leave(): Promise<void>;
  destroy(): void;
}
