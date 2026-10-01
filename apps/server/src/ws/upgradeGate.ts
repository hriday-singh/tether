import { IncomingMessage } from 'node:http';
import { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { ServerConfig } from '../config.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { JoinService, RoomTokenClaims } from '../services/joinService.js';
import { AuditRepo } from '../repo/auditRepo.js';
import { AuditService } from '../services/auditService.js';
import { ChatService } from '../services/chatService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { PROTOCOL_VERSION, MAX_MEMBERS_PER_ROOM, MAX_CONN_PER_IP } from '@tether/shared/constants';
import { attachConnectionHandler } from './connectionHandler.js';

import { PersistenceService } from '../services/persistenceService.js';

import { BotStormManager } from '../rooms/botStormManager.js';

export interface UpgradeGateDependencies {
  config: ServerConfig;
  roomRepo: RoomRepo;
  memberRepo: MemberRepo;
  joinService: JoinService;
  roomRegistry: RoomRegistry;
  auditRepo: AuditRepo;
  auditService: AuditService;
  chatService: ChatService;
  persistenceService?: PersistenceService;
  botStormManager?: BotStormManager;
  serverPort?: number;
}

const ipConnectionCounts = new Map<string, number>();
let isDraining = false;

export function setDraining(draining: boolean): void {
  isDraining = draining;
}

export function getIsDraining(): boolean {
  return isDraining;
}

export function resetUpgradeGateState(): void {
  isDraining = false;
  ipConnectionCounts.clear();
}

export function createUpgradeGate(wss: WebSocketServer, deps: UpgradeGateDependencies) {
  return async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    function reject(status: number, reason: string) {
      socket.write(
        `HTTP/1.1 ${status} ${reason}\r\n` +
          `Connection: close\r\n` +
          `Content-Type: text/plain\r\n\r\n` +
          reason
      );
      socket.destroy();
    }

    if (isDraining) {
      return reject(503, 'Service Unavailable: Server Draining');
    }
    if (deps.persistenceService?.isBufferFull()) {
      return reject(503, 'Service Unavailable: Persistence Buffer Full');
    }

    const url = request.url ?? '';
    const match = url.match(/^\/ws\/rooms\/([a-z0-9-]+)\/?$/i);
    if (!match) {
      return reject(400, 'Bad Request: Invalid WebSocket URL');
    }
    const roomId = match[1]!.toLowerCase();

    // Check 1: Origin
    const origin = request.headers.origin;
    if (origin && !deps.config.ALLOWED_ORIGINS.includes(origin)) {
      return reject(403, 'Forbidden: Origin Not Allowed');
    }

    // Check 2: Subprotocols
    const subprotocolsHeader = request.headers['sec-websocket-protocol'] ?? '';
    const protocols = subprotocolsHeader
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (protocols.length < 2 || protocols[0] !== PROTOCOL_VERSION) {
      return reject(400, 'Bad Request: Missing or Invalid Subprotocol');
    }
    const token = protocols[1]!;

    // Check 3: Token validation
    let claims: RoomTokenClaims;
    try {
      claims = await deps.joinService.verifyRoomToken(token, roomId);
    } catch {
      return reject(401, 'Unauthorized: Invalid Token');
    }

    // Check 4: Room existence
    const room = deps.roomRepo.findById(roomId);
    if (!room) {
      return reject(404, 'Not Found: Room Does Not Exist');
    }

    // Validate epoch and passcode version
    if (claims.ep !== room.epoch) {
      return reject(401, 'Unauthorized: Stale Epoch');
    }
    if (room.passcode_hash !== null && claims.pv !== room.passcode_version) {
      return reject(401, 'Unauthorized: Stale Passcode Version');
    }

    // Check 5: Member not banned
    if (deps.memberRepo.isBanned(roomId, claims.sub)) {
      return reject(403, 'Forbidden: Member Banned');
    }

    // Check 6: Room not locked (or member previously admitted)
    if (room.locked === 1 && !deps.memberRepo.getMember(roomId, claims.sub)) {
      return reject(403, 'Forbidden: Room Locked');
    }

    // Check 7: IP and Member Caps
    let ip = request.socket.remoteAddress || 'unknown';
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) ip = first;
    }
    const currentIpConns = ipConnectionCounts.get(ip) ?? 0;
    if (currentIpConns >= MAX_CONN_PER_IP) {
      return reject(429, 'Too Many Requests: IP Connection Limit Reached');
    }

    const members = deps.memberRepo.getMembers(roomId);
    if (members.length >= MAX_MEMBERS_PER_ROOM && !members.some((m) => m.member_id === claims.sub)) {
      return reject(429, 'Too Many Requests: Room Member Limit Reached');
    }

    // All 8 checks passed! Admit client and complete handshake
    ipConnectionCounts.set(ip, currentIpConns + 1);

    wss.handleUpgrade(request, socket, head, (ws) => {
      let decremented = false;
      const cleanupIp = () => {
        if (decremented) return;
        decremented = true;
        const count = ipConnectionCounts.get(ip) ?? 1;
        if (count <= 1) ipConnectionCounts.delete(ip);
        else ipConnectionCounts.set(ip, count - 1);
      };
      ws.on('close', cleanupIp);
      ws.on('error', cleanupIp);

      const activeRoom = deps.roomRegistry.getOrCreate(roomId);
      if (!activeRoom) {
        ws.close(1011, 'Internal Error');
        return;
      }

      const memberRecord = deps.memberRepo.getMember(roomId, claims.sub);
      const memberInfo = {
        id: claims.sub,
        name: claims.name,
        colorIndex: memberRecord?.color_index ?? 0,
      };

      attachConnectionHandler(ws, activeRoom, memberInfo, deps);
    });
  };
}
