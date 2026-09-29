import * as Y from 'yjs';
import WebSocket from 'ws';
import { Room } from '../rooms/room.js';
import { UpgradeGateDependencies } from './upgradeGate.js';
import { decodeFrame, encodeFrame, BinaryFrame } from '@tether/shared/protocol/codec';
import {
  ClientControlMessageSchema,
  ClientControlMessage,
  Member,
} from '@tether/shared/protocol/schemas';
import {
  FRAME_KINDS,
  SERVER_PING_MS,
  WS_CLOSE_CODES,
} from '@tether/shared/constants';

export function attachConnectionHandler(
  ws: WebSocket,
  room: Room,
  member: { id: string; name: string; colorIndex: number },
  deps: UpgradeGateDependencies
): void {
  room.addConnection(ws, member);

  let isAlive = true;
  ws.on('pong', () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      clearInterval(pingInterval);
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, SERVER_PING_MS);

  // Send Welcome message
  const roomRow = deps.roomRepo.findById(room.id)!;
  const allMembers = deps.memberRepo.getMembers(room.id).map((m): Member => ({
    id: m.member_id,
    name: m.display_name,
    colorIndex: m.color_index,
    joinedAt: m.first_joined_at,
    status: 'active',
    isHost: room.hostElector.hostId === m.member_id,
    isBot: false,
  }));

  const selfMember: Member = {
    id: member.id,
    name: member.name,
    colorIndex: member.colorIndex,
    joinedAt: new Date().toISOString(),
    status: 'active',
    isHost: room.hostElector.hostId === member.id,
    isBot: false,
  };

  const welcomePayload = {
    t: 'welcome' as const,
    self: selfMember,
    members: allMembers,
    hostId: room.hostElector.hostId,
    room: {
      id: room.id,
      language: roomRow.language,
      locked: roomRow.locked === 1,
      hasPasscode: roomRow.passcode_hash !== null,
      epoch: room.epoch,
    },
    token: '', // sliding token
    eventSeq: 0,
  };
  ws.send(JSON.stringify(welcomePayload));

  // Handle incoming data
  ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      const buffer = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
      try {
        const frame = decodeFrame(buffer);

        switch (frame.kind) {
          case FRAME_KINDS.SYNC_STEP1: {
            // Client sent state vector; send missing updates, then server's state vector
            const serverUpdate = Y.encodeStateAsUpdate(room.doc, frame.stateVector);
            const step2Frame: BinaryFrame = {
              kind: FRAME_KINDS.SYNC_STEP2,
              seq: 0,
              update: serverUpdate,
            };
            ws.send(encodeFrame(step2Frame));

            const serverSv = Y.encodeStateVector(room.doc);
            const step1Reply: BinaryFrame = {
              kind: FRAME_KINDS.SYNC_STEP1,
              stateVector: serverSv,
            };
            ws.send(encodeFrame(step1Reply));
            break;
          }
          case FRAME_KINDS.SYNC_STEP2: {
            room.handleInboundSyncStep2(ws, frame.update);
            break;
          }
          case FRAME_KINDS.UPDATE: {
            room.handleInboundUpdate(ws, frame.seq, frame.docUpdate, frame.awarenessUpdate);
            break;
          }
        }
      } catch {
        ws.close(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
      }
    } else {
      // JSON control messages
      try {
        const text = data.toString('utf-8');
        const msg: ClientControlMessage = ClientControlMessageSchema.parse(JSON.parse(text));

        switch (msg.t) {
          case 'ping': {
            ws.send(JSON.stringify({ t: 'pong', id: msg.id, ts: msg.ts, serverQueueMs: 0 }));
            break;
          }
          case 'leave': {
            room.removeConnection(ws, true);
            ws.close(WS_CLOSE_CODES.NORMAL);
            break;
          }
          case 'host.kick': {
            if (room.hostElector.hostId !== member.id) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Not host' }));
              return;
            }
            deps.memberRepo.banMember(room.id, msg.memberId);
            room.broadcastControl({
              t: 'member.left',
              memberId: msg.memberId,
              reason: 'kicked',
            });
            ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            break;
          }
          case 'host.lock': {
            if (room.hostElector.hostId !== member.id) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Not host' }));
              return;
            }
            deps.roomRepo.updateSettings(room.id, { locked: msg.locked });
            room.broadcastControl({
              t: 'room.updated',
              settings: { locked: msg.locked },
            });
            ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            break;
          }
          case 'host.passcode': {
            if (room.hostElector.hostId !== member.id) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Not host' }));
              return;
            }
            let hash: string | null = null;
            if (msg.passcode) {
              hash = await deps.joinService.hashPasscode(msg.passcode);
            }
            const current = deps.roomRepo.findById(room.id);
            const nextPv = (current?.passcode_version ?? 0) + 1;
            deps.roomRepo.updateSettings(room.id, { passcodeHash: hash, passcodeVersion: nextPv });
            room.broadcastControl({
              t: 'room.updated',
              settings: { hasPasscode: hash !== null },
            });
            ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            break;
          }
          case 'host.transfer': {
            if (room.hostElector.hostId !== member.id) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Not host' }));
              return;
            }
            const ok = room.hostElector.manualTransfer(msg.memberId);
            if (ok) {
              ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            } else {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'bad_request', message: 'Target not active' }));
            }
            break;
          }
          case 'room.language': {
            if (room.hostElector.hostId !== member.id) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Not host' }));
              return;
            }
            deps.roomRepo.updateSettings(room.id, { language: msg.language });
            room.broadcastControl({
              t: 'room.updated',
              settings: { language: msg.language },
            });
            ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            break;
          }
          case 'verify.mismatch': {
            // Client detected mismatch; reply with current full doc state
            const fullUpdate = Y.encodeStateAsUpdate(room.doc);
            const resyncFrame: BinaryFrame = {
              kind: FRAME_KINDS.SYNC_STEP2,
              seq: 0,
              update: fullUpdate,
            };
            ws.send(encodeFrame(resyncFrame));
            break;
          }
        }
      } catch {
        ws.close(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    room.removeConnection(ws, false);
  });
}
