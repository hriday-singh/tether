import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { FastifyInstance } from 'fastify';
import { createDatabase, DatabaseSession } from '../../src/db/database.js';
import { RoomRepo } from '../../src/repo/roomRepo.js';
import { UpdateRepo } from '../../src/repo/updateRepo.js';
import { MemberRepo } from '../../src/repo/memberRepo.js';
import { AuditRepo } from '../../src/repo/auditRepo.js';
import { JoinService } from '../../src/services/joinService.js';
import { RoomService } from '../../src/services/roomService.js';
import { AuditService } from '../../src/services/auditService.js';
import { ChatService } from '../../src/services/chatService.js';
import { ChatRepo } from '../../src/repo/chatRepo.js';
import { PersistenceService } from '../../src/services/persistenceService.js';
import { RoomRegistry } from '../../src/rooms/roomRegistry.js';
import { buildApp } from '../../src/http/app.js';
import { createUpgradeGate } from '../../src/ws/upgradeGate.js';
import { ServerConfig } from '../../src/config.js';
import { PROTOCOL_VERSION } from '@tether/shared/constants';

describe('Admission Check 8 & Buffer Full Protection', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let memberRepo: MemberRepo;
  let auditRepo: AuditRepo;
  let joinService: JoinService;
  let auditService: AuditService;
  let roomService: RoomService;
  let persistenceService: PersistenceService;
  let roomRegistry: RoomRegistry;
  let app: FastifyInstance;
  let wss: WebSocketServer;
  let serverPort: number;

  const mockConfig: ServerConfig = {
    PORT: 0,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    JWT_SECRET: 'super_secret_jwt_key_that_is_at_least_32_characters_long',
    ALLOWED_ORIGINS: ['http://localhost:3000'],
    DATABASE_DRIVER: 'sqlite',
    SQLITE_PATH: ':memory:',
    HOST_GRACE_MS: 5000,
    PERSIST_FLUSH_MS: 100,
    ROOM_UNLOAD_IDLE_MS: 30000,
    DEMO_MODE: false,
  };

  beforeEach(async () => {
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    memberRepo = new MemberRepo(db);
    auditRepo = new AuditRepo(db);

    joinService = new JoinService(mockConfig.JWT_SECRET);
    auditService = new AuditService(auditRepo);
    const chatService = new ChatService(new ChatRepo(db));
    roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    persistenceService = new PersistenceService(updateRepo, roomRepo, 1000, 2);
    roomRegistry = new RoomRegistry(roomRepo, updateRepo, persistenceService, auditService, 30000);

    const deps = {
      config: mockConfig,
      roomService,
      joinService,
      auditService,
      roomRegistry,
      roomRepo,
      memberRepo,
      auditRepo,
      chatService,
      persistenceService,
    };

    app = buildApp(deps);
    wss = new WebSocketServer({ noServer: true });
    const upgradeHandler = createUpgradeGate(wss, deps);

    app.server.on('upgrade', (req, socket, head) => {
      upgradeHandler(req, socket, head);
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    serverPort = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    roomRegistry.destroy();
    persistenceService.destroy();
    wss.close();
    await app.close();
    db.close();
  });

  it('returns 503 buffer_full on /health/ready when persistence buffer is full', async () => {
    const readyBefore = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(readyBefore.statusCode).toBe(200);

    (persistenceService as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = 2;
    expect(persistenceService.isBufferFull()).toBe(true);

    const readyAfter = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(readyAfter.statusCode).toBe(503);
    expect(readyAfter.json()).toEqual({ status: 'buffer_full' });
  });

  it('returns draining status on /api/rooms/:id/admission when buffer is full', async () => {
    const createRes = await roomService.createRoom({ roomId: 'test-room', creatorName: 'Host' });
    if ('error' in createRes) throw new Error('Create failed');
    const token = await joinService.issueRoomToken({
      roomId: 'test-room',
      memberId: 'm1',
      displayName: 'Host',
      roomEpoch: createRes.room.epoch,
      passcodeVersion: 0,
    });

    (persistenceService as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = 2;

    const admRes = await app.inject({
      method: 'GET',
      url: '/api/rooms/test-room/admission',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(admRes.statusCode).toBe(200);
    expect(admRes.json()).toEqual({ status: 'draining' });
  });

  it('rejects WebSocket upgrade with 503 when buffer is full (Check 8)', async () => {
    const createRes = await roomService.createRoom({ roomId: 'gate-room', creatorName: 'Host' });
    if ('error' in createRes) throw new Error('Create failed');
    const token = await joinService.issueRoomToken({
      roomId: 'gate-room',
      memberId: 'm1',
      displayName: 'Host',
      roomEpoch: createRes.room.epoch,
      passcodeVersion: 0,
    });

    (persistenceService as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = 2;

    const wsPromise = new Promise<{ code?: number; error?: string }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/gate-room`, [
        PROTOCOL_VERSION,
        token,
      ], {
        headers: { Origin: 'http://localhost:3000' },
      });
      ws.on('unexpected-response', (_req, res) => {
        resolve({ code: res.statusCode });
      });
      ws.on('error', (err) => {
        resolve({ error: err.message });
      });
    });

    const result = await wsPromise;
    expect(result.code).toBe(503);
  });
});
