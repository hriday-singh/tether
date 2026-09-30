import * as Y from 'yjs';
import type WebSocket from 'ws';
import type {
  Member,
  RoomMetadata,
  AuditEvent,
  ChatMessage,
} from '@tether/shared/protocol/schemas';
import type { ClientStats } from './statsStore.js';
import type { WakeTarget, WakeDocumentTarget } from './wakeManager.js';
import type { StorageIDBFactory } from './indexedDbStorage.js';

export type ClientConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'kicked'
  | 'offline';

export type SyncState = 'synced' | 'saving' | 'saved' | 'mismatch';

export interface SyncStorageOptions {
  roomId: string;
  roomEpoch: string;
  idbFactory?: StorageIDBFactory;
  debounceMs?: number;
}

export interface SyncClientOptions {
  url: string;
  token: string;
  doc: Y.Doc;
  apiUrl?: string;
  roomId?: string;
  fetchFn?: typeof fetch;
  storage?: SyncStorageOptions;
  webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
  batchWindowMs?: number;
  onStatusChange?: (status: ClientConnectionStatus) => void;
  onSyncStateChange?: (state: SyncState) => void;
  onRosterChange?: (members: Member[]) => void;
  onHostChange?: (hostId: string | null) => void;
  onWelcome?: (welcome: { self: Member; room: RoomMetadata; chatSeq: number; eventSeq: number }) => void;
  onStatsChange?: (stats: ClientStats) => void;
  onReauthRequired?: (reason?: string) => void;
  onBanned?: () => void;
  onRoomNotFound?: () => void;
  onRoomLocked?: () => void;
  onError?: (err: Error) => void;
  onAwarenessUpdate?: (update: Uint8Array) => void;
  onRoomUpdate?: (settings: { locked?: boolean; hasPasscode?: boolean; language?: string }) => void;
  onEvent?: (event: AuditEvent) => void;
  onChat?: (message: ChatMessage) => void;
  /** Every server checksum broadcast: `matched` is true when this replica equals the server's (same state vector and text hash). */
  onChecksum?: (result: { hash: string; matched: boolean }) => void;
  /** Server issued a refreshed room token (used for the next reconnect). */
  onToken?: (token: string) => void;
  /** Server is rate-limiting broadcasts to this client for `windowMs`. */
  onThrottled?: (windowMs: number) => void;
  /** Reconnect attempt `attempt` fires in `delayMs`. */
  onReconnectScheduled?: (attempt: number, delayMs: number) => void;
  /** Simulated latency applied to every frame in both directions (network lab). */
  latencyMs?: number;
  clock?: () => number;
  statsWindowSize?: number;
  wakeProbeTimeoutMs?: number;
  wakeTarget?: {
    window?: WakeTarget;
    document?: WakeDocumentTarget;
  };
}
