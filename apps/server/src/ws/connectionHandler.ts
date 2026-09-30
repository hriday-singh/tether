import * as Y from 'yjs';
import WebSocket from 'ws';
import { Room } from '../rooms/room.js';
import { UpgradeGateDependencies } from './upgradeGate.js';
import { ProtocolGuard } from '../sync/protocolGuard.js';
import { decodeFrame, encodeFrame, BinaryFrame } from '@tether/shared/protocol/codec';
import {
  ClientControlMessageSchema,
  ClientControlMessage,
  Member,
} from '@tether/shared/protocol/schemas';
import {
  CHAT_BURST,
  CHAT_RATE_PER_SEC,
  FRAME_KINDS,
  MAX_MEMBERS_PER_ROOM,
  SERVER_PING_MS,
  WS_CLOSE_CODES,
} from '@tether/shared/constants';
import { TokenBucket } from '@tether/shared/tokenBucket';
import { disambiguateDisplayNames } from '../rooms/rosterUtils.js';

export interface ConnectionHandlerOptions {
  tokenRefreshIntervalMs?: number; // default: 3600000 (1 hour)
}

export async function attachConnectionHandler(
  ws: WebSocket,
  room: Room,
  member: { id: string; name: string; colorIndex: number },
  deps: UpgradeGateDependencies,
  options: ConnectionHandlerOptions = {}
): Promise<void> {
  const { isNew } = room.addConnection(ws, member);
  const protocolGuard = new ProtocolGuard();
  // Chat has its own budget so chatting never eats the 5 frames/s edit throttle (ADR-017).
  const chatBucket = new TokenBucket(CHAT_RATE_PER_SEC, CHAT_BURST);

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

  // Sliding Token Refresh: push renewed JWT periodically (hourly by default)
  const tokenRefreshIntervalMs = options.tokenRefreshIntervalMs ?? 3600000;
  const tokenRefreshInterval = setInterval(async () => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const currentRoomRow = deps.roomRepo.findById(room.id);
        if (currentRoomRow) {
          const freshToken = await deps.joinService.issueRoomToken({
            memberId: member.id,
            roomId: room.id,
            displayName: member.name,
            passcodeVersion: currentRoomRow.passcode_version,
            roomEpoch: room.epoch,
          });
          ws.send(JSON.stringify({ t: 'token', token: freshToken }));
        }
      } catch {
        // Keep connection alive even if refresh attempt fails
      }
    }
  }, tokenRefreshIntervalMs);

  // Send Welcome message with disambiguated names
  const roomRow = deps.roomRepo.findById(room.id)!;
  const rawMembers = deps.memberRepo.getMembers(room.id).map((m): Member => ({
    id: m.member_id,
    name: m.display_name,
    colorIndex: m.color_index,
    joinedAt: m.first_joined_at,
    status: 'active',
    isHost: room.hostElector.hostId === m.member_id,
    isBot: room.isBot(m.member_id),
  }));
  const allMembers = disambiguateDisplayNames(rawMembers);

  const selfMember: Member = allMembers.find((m) => m.id === member.id) ?? {
    id: member.id,
    name: member.name,
    colorIndex: member.colorIndex,
    joinedAt: new Date().toISOString(),
    status: 'active',
    isHost: room.hostElector.hostId === member.id,
    isBot: room.isBot(member.id),
  };

  const token = await deps.joinService.issueRoomToken({
    memberId: member.id,
    roomId: room.id,
    displayName: member.name,
    passcodeVersion: roomRow.passcode_version,
    roomEpoch: room.epoch,
  });
  const eventSeq = deps.auditRepo.getLatestSeq(room.id);

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
    token,
    eventSeq,
    chatSeq: deps.chatService.getLatestSeq(room.id),
  };
  ws.send(JSON.stringify(welcomePayload));

  if (isNew) {
    room.broadcastControl(
      {
        t: 'member.joined',
        member: selfMember,
      },
      ws
    );
    deps.auditService.logEvent(room.id, {
      type: 'member.joined',
      actorMemberId: member.id,
      actorName: member.name,
      payload: {},
    });
  }

  ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      const buffer = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
      try {
        const frame = decodeFrame(buffer);
        const violation = protocolGuard.checkFrame(frame);
        if (violation !== null) {
          deps.auditService.logEvent(room.id, {
            type: 'security.protocol',
            actorMemberId: member.id,
            actorName: member.name,
            payload: { code: violation },
          });
          ws.close(violation);
          return;
        }

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
            // Handshake done: verify the new replica even if the room is idle (no doc update would trigger it).
            room.scheduleChecksum();
            break;
          }
          case FRAME_KINDS.UPDATE: {
            room.handleInboundUpdate(ws, frame.seq, frame.docUpdate, frame.awarenessUpdate);
            break;
          }
        }
      } catch {
        deps.auditService.logEvent(room.id, {
          type: 'security.protocol',
          actorMemberId: member.id,
          actorName: member.name,
          payload: { code: WS_CLOSE_CODES.PROTOCOL_VIOLATION },
        });
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
            deps.auditService.logEvent(room.id, {
              type: 'member.left',
              actorMemberId: member.id,
              actorName: member.name,
              payload: { reason: 'leave' },
            });
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
            deps.auditService.logEvent(room.id, {
              type: 'member.left',
              actorMemberId: member.id,
              actorName: member.name,
              payload: { reason: 'kicked', targetMemberId: msg.memberId },
            });
            room.terminateMemberSockets(msg.memberId, WS_CLOSE_CODES.KICKED);
            ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            break;
          }
          case 'host.lock': {
            if (room.hostElector.hostId !== member.id) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Not host' }));
              return;
            }
            const currentRoom = deps.roomRepo.findById(room.id);
            const isAlready = (currentRoom?.locked === 1) === msg.locked;
            if (!isAlready) {
              deps.roomRepo.updateSettings(room.id, { locked: msg.locked });
              room.broadcastControl({
                t: 'room.updated',
                settings: { locked: msg.locked },
              });
              deps.auditService.logEvent(room.id, {
                type: msg.locked ? 'room.locked' : 'room.unlocked',
                actorMemberId: member.id,
                actorName: member.name,
                payload: {},
              });
            }
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
            const action = !hash ? 'cleared' : !current?.passcode_hash ? 'set' : 'changed';
            const nextPv = (current?.passcode_version ?? 0) + 1;
            deps.roomRepo.updateSettings(room.id, { passcodeHash: hash, passcodeVersion: nextPv });
            room.broadcastControl({
              t: 'room.updated',
              settings: { hasPasscode: hash !== null },
            });
            deps.auditService.logEvent(room.id, {
              type: 'room.passcode',
              actorMemberId: member.id,
              actorName: member.name,
              payload: { action },
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
            const current = deps.roomRepo.findById(room.id);
            if (current?.language !== msg.language) {
              const fromLang = current?.language ?? 'javascript';
              deps.roomRepo.updateSettings(room.id, { language: msg.language });
              room.broadcastControl({
                t: 'room.updated',
                settings: { language: msg.language },
              });
              deps.auditService.logEvent(room.id, {
                type: 'room.language',
                actorMemberId: member.id,
                actorName: member.name,
                payload: { from: fromLang, to: msg.language },
              });
            }
            ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            break;
          }
          case 'chat.send': {
            if (!chatBucket.take()) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'rate_limited', message: 'Sending too fast' }));
              return;
            }
            const { message, created } = deps.chatService.post(room.id, {
              clientMsgId: msg.rid,
              memberId: member.id,
              name: member.name,
              colorIndex: member.colorIndex,
              text: msg.text,
            });
            const out = JSON.stringify({ t: 'chat.msg', message });
            // A resend (same rid) was already broadcast: only the sender needs it back.
            if (created) room.broadcastControl({ t: 'chat.msg', message });
            else ws.send(out);
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
          case 'demo.storm': {
            if (room.hostElector.hostId !== member.id) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Not host' }));
              return;
            }
            if (!deps.config.DEMO_MODE) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'forbidden', message: 'Demo mode disabled' }));
              return;
            }
            if (!deps.botStormManager) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'bad_request', message: 'Storm spawner unavailable' }));
              return;
            }
            if (deps.botStormManager.isStormActive(room.id)) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'conflict', message: 'Storm already active' }));
              return;
            }

            const currentMemberCount = deps.memberRepo.getMembers(room.id).length;
            if (currentMemberCount + msg.bots > MAX_MEMBERS_PER_ROOM) {
              ws.send(JSON.stringify({ t: 'error', rid: msg.rid, code: 'bad_request', message: 'Room capacity exceeded' }));
              return;
            }

            deps.auditService.logEvent(room.id, {
              type: 'demo.storm',
              actorMemberId: member.id,
              actorName: member.name,
              payload: { bots: msg.bots, seconds: msg.seconds, faults: msg.faults },
            });

            const port = deps.serverPort ?? (deps.config.PORT || 4000);
            void deps.botStormManager
              .startStorm({
                roomId: room.id,
                hostMemberId: member.id,
                bots: msg.bots,
                seconds: msg.seconds,
                faults: msg.faults,
                port,
              })
              .catch((err) => {
                console.error(`[demo.storm] Failed to run storm in room ${room.id}:`, err);
              });

            ws.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
            break;
          }
        }
      } catch {
        deps.auditService.logEvent(room.id, {
          type: 'security.protocol',
          actorMemberId: member.id,
          actorName: member.name,
          payload: { code: WS_CLOSE_CODES.PROTOCOL_VIOLATION },
        });
        ws.close(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(tokenRefreshInterval);
    room.removeConnection(ws, false);
  });
}
