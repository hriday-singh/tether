import * as Y from 'yjs';
import WebSocket from 'ws';
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
  clock?: () => number;
  statsWindowSize?: number;
  wakeProbeTimeoutMs?: number;
  wakeTarget?: {
    window?: WakeTarget;
    document?: WakeDocumentTarget;
  };
}
