import * as Y from 'yjs';
import {
  ClientControlMessage,
  ServerControlMessage,
  ServerControlMessageSchema,
  Member,
  RoomMetadata,
} from '@tether/shared/protocol/schemas';
import { areStateVectorsEqual, hashString } from '@tether/shared/checksum';
import { StatsStore } from './statsStore.js';
import { WakeManager } from './wakeManager.js';
import type {
  ClientConnectionStatus,
  SyncState,
  SyncClientOptions,
} from './types.js';

export interface ControlDispatcherContext {
  doc: Y.Doc;
  options: SyncClientOptions;
  clock: () => number;
  statsStore: StatsStore;
  wakeManager: WakeManager | null;
  pendingAcks: Map<number, { docUpdate: Uint8Array; sentAt: number }>;
  pendingCommands: Map<string, { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>;
  members: Member[];
  hostId: string | null;
  room: RoomMetadata | null;
  self: Member | null;
  token: string;
  hasReceivedWelcome: boolean;
  setStatus: (status: ClientConnectionStatus) => void;
  setSyncState: (state: SyncState) => void;
  sendControl: (msg: ClientControlMessage) => void;
  setHasReceivedWelcome: (val: boolean) => void;
  setMembers: (members: Member[]) => void;
  setHostId: (hostId: string | null) => void;
  setRoom: (room: RoomMetadata | null) => void;
  setSelf: (self: Member | null) => void;
  setToken: (token: string) => void;
}

export function dispatchControlMessage(
  ctx: ControlDispatcherContext,
  jsonStr: string
): void {
  try {
    const raw = JSON.parse(jsonStr);
    const parsed: ServerControlMessage = ServerControlMessageSchema.parse(raw);

    switch (parsed.t) {
      case 'welcome': {
        ctx.setHasReceivedWelcome(true);
        ctx.setSelf(parsed.self);
        ctx.setMembers(parsed.members);
        ctx.setHostId(parsed.hostId);
        ctx.setRoom(parsed.room);
        ctx.setStatus('connected');
        ctx.pendingAcks.clear();
        ctx.setSyncState('synced');
        ctx.options.onWelcome?.({
          self: parsed.self,
          room: parsed.room,
          chatSeq: parsed.chatSeq,
          eventSeq: parsed.eventSeq,
        });
        ctx.options.onRosterChange?.(parsed.members);
        ctx.options.onHostChange?.(parsed.hostId);
        break;
      }
      case 'pong': {
        const now = ctx.clock();
        const rtt = Math.max(0, now - parsed.ts);
        ctx.statsStore.recordRtt(rtt);
        ctx.wakeManager?.clearProbe();
        ctx.options.onStatsChange?.(ctx.statsStore.getStats());
        break;
      }
      case 'ack': {
        const pending = ctx.pendingAcks.get(parsed.seq);
        if (pending) {
          const ackLatency = Math.max(0, ctx.clock() - pending.sentAt);
          ctx.statsStore.recordAckLatency(ackLatency);
          ctx.pendingAcks.delete(parsed.seq);
          ctx.options.onStatsChange?.(ctx.statsStore.getStats());
        }
        if (ctx.pendingAcks.size === 0) {
          ctx.setSyncState('saved');
        }
        break;
      }
      case 'ok':
      case 'error': {
        const pending = parsed.rid ? ctx.pendingCommands.get(parsed.rid) : undefined;
        if (!pending || !parsed.rid) break;
        clearTimeout(pending.timer);
        ctx.pendingCommands.delete(parsed.rid);
        if (parsed.t === 'ok') pending.resolve();
        else pending.reject(new Error(parsed.code));
        break;
      }
      case 'token': {
        // Hourly refresh: reconnects must present the fresh token, and the app persists it for reloads.
        ctx.setToken(parsed.token);
        ctx.options.onToken?.(parsed.token);
        break;
      }
      case 'room.updated': {
        if (ctx.room) {
          ctx.setRoom({
            ...ctx.room,
            ...(parsed.settings.language ? { language: parsed.settings.language } : {}),
            ...(parsed.settings.locked !== undefined ? { locked: parsed.settings.locked } : {}),
            ...(parsed.settings.hasPasscode !== undefined ? { hasPasscode: parsed.settings.hasPasscode } : {}),
          });
        }
        ctx.options.onRoomUpdate?.(parsed.settings);
        break;
      }
      case 'event': {
        ctx.options.onEvent?.(parsed.event);
        break;
      }
      case 'chat.msg': {
        ctx.options.onChat?.(parsed.message);
        break;
      }
      case 'member.joined': {
        const updated = [...ctx.members.filter((m) => m.id !== parsed.member.id), parsed.member];
        ctx.setMembers(updated);
        ctx.options.onRosterChange?.(updated);
        break;
      }
      case 'member.left': {
        const updated = ctx.members.filter((m) => m.id !== parsed.memberId);
        ctx.setMembers(updated);
        ctx.options.onRosterChange?.(updated);
        break;
      }
      case 'member.status': {
        const updated = ctx.members.map((m) =>
          m.id === parsed.memberId ? { ...m, status: parsed.status } : m
        );
        ctx.setMembers(updated);
        ctx.options.onRosterChange?.(updated);
        break;
      }
      case 'throttled': {
        ctx.options.onThrottled?.(parsed.windowMs);
        break;
      }
      case 'host.changed': {
        ctx.setHostId(parsed.hostId);
        ctx.options.onHostChange?.(parsed.hostId);
        break;
      }
      case 'checksum': {
        const localSv = Y.encodeStateVector(ctx.doc);
        const localText = ctx.doc.getText('codemirror').toString();
        const localHash = hashString(localText);

        const matched = areStateVectorsEqual(localSv, Buffer.from(parsed.sv, 'base64')) && localHash === parsed.hash;
        ctx.options.onChecksum?.({ hash: parsed.hash, matched });
        if (matched) {
          ctx.setSyncState('synced');
        } else {
          ctx.setSyncState('mismatch');
          ctx.sendControl({
            t: 'verify.mismatch',
            sv: Buffer.from(localSv).toString('base64'),
            hash: localHash,
          });
        }
        break;
      }
    }
  } catch (err) {
    ctx.options.onError?.(new Error(`Failed to parse control message: ${String(err)}`));
  }
}
