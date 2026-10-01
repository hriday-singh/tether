import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { FastifyInstance } from 'fastify';
import { createDatabase, DatabaseSession } from '../../src/db/database.js';
import { RoomRepo } from '../../src/repo/roomRepo.js';
import { UpdateRepo } from '../../src/repo/updateRepo.js';
import { MemberRepo } from '../../src/repo/memberRepo.js';
import { AuditRepo } from '../../src/repo/auditRepo.js';
import { ChatRepo } from '../../src/repo/chatRepo.js';
import { JoinService } from '../../src/services/joinService.js';
import { RoomService } from '../../src/services/roomService.js';
import { AuditService } from '../../src/services/auditService.js';
import { ChatService } from '../../src/services/chatService.js';
import { PersistenceService } from '../../src/services/persistenceService.js';
import { RoomRegistry } from '../../src/rooms/roomRegistry.js';
import { buildApp } from '../../src/http/app.js';
import { createUpgradeGate } from '../../src/ws/upgradeGate.js';
import { SyncClient } from '@tether/sync-client';
import { ServerConfig } from '../../src/config.js';

async function waitFor(fn: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Host Handover Timing & Race Integration Tests', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let memberRepo: MemberRepo;
  let auditRepo: AuditRepo;
  let chatRepo: ChatRepo;

  let joinService: JoinService;
  let auditService: AuditService;
  let chatService: ChatService;
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
    ALLOWED_ORIGINS: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    DATABASE_DRIVER: 'sqlite',
    SQLITE_PATH: ':memory:',
    HOST_GRACE_MS: 300, // 300ms grace window for fast and deterministic test runs
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
    chatRepo = new ChatRepo(db);

    joinService = new JoinService(mockConfig.JWT_SECRET);
    auditService = new AuditService(auditRepo);
    chatService = new ChatService(chatRepo);
    roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    persistenceService = new PersistenceService(updateRepo, roomRepo, mockConfig.PERSIST_FLUSH_MS);
    roomRegistry = new RoomRegistry(
      roomRepo,
      updateRepo,
      persistenceService,
      auditService,
      mockConfig.ROOM_UNLOAD_IDLE_MS,
      mockConfig.HOST_GRACE_MS
    );

    const deps = {
      config: mockConfig,
      roomService,
      joinService,
      auditService,
      chatService,
      roomRegistry,
      roomRepo,
      memberRepo,
      auditRepo,
      persistenceService,
    };

    app = buildApp(deps);
    wss = new WebSocketServer({ noServer: true });
    const upgradeHandler = createUpgradeGate(wss, deps);

    app.server.on('upgrade', (req, socket, head) => {
      upgradeHandler(req, socket, head);
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    serverPort = typeof address === 'object' && address ? address.port : 4000;
  });

  afterEach(async () => {
    roomRegistry.destroy();
    persistenceService.destroy();
    wss.close();
    await app.close();
    db.close();
  });

  it('rejects host-only commands from former host immediately after clean leave', async () => {
    // 1. Alice creates room (she becomes host)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Alice', roomId: 'race-room-1' },
    });
    const { token: aliceToken, memberId: aliceId } = JSON.parse(createRes.body);

    // 2. Bob joins room
    const joinRes = await app.inject({
      method: 'POST',
      url: '/api/rooms/race-room-1/join',
      payload: { name: 'Bob' },
    });
    const { token: bobToken, memberId: bobId } = JSON.parse(joinRes.body);

    const docAlice = new Y.Doc();
    const docBob = new Y.Doc();

    const clientAlice = new SyncClient({
      url: `ws://127.0.0.1:${serverPort}/ws/rooms/race-room-1`,
      token: aliceToken,
      doc: docAlice,
    });

    const clientBob = new SyncClient({
      url: `ws://127.0.0.1:${serverPort}/ws/rooms/race-room-1`,
      token: bobToken,
      doc: docBob,
    });

    await clientAlice.connect();
    await clientBob.connect();

    // Wait until both connect and have Alice as host
    await waitFor(() => clientAlice.hostId === aliceId && clientBob.hostId === aliceId);
    expect(clientAlice.hostId).toBe(aliceId);
    expect(clientBob.hostId).toBe(aliceId);

    // Alice performs clean leave
    clientAlice.sendControl({ t: 'leave' });
    await waitFor(() => clientBob.hostId === bobId);

    // Bob must now be elected host immediately
    expect(clientBob.hostId).toBe(bobId);

    // Alice tries to execute a host command (host.lock) after leaving
    let errorReceived: any = null;
    const rawWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/race-room-1`, ['collab.v1', aliceToken]);
    await new Promise<void>((resolve) => {
      rawWs.on('open', () => resolve());
    });

    const reqId = crypto.randomUUID();
    rawWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.rid === reqId) {
          errorReceived = msg;
        }
      } catch {}
    });

    rawWs.send(JSON.stringify({ t: 'host.lock', rid: reqId, locked: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(errorReceived).toEqual({
      t: 'error',
      rid: reqId,
      code: 'forbidden',
      message: 'Not host',
    });

    rawWs.close();
    clientAlice.destroy();
    clientBob.destroy();
  });

  it('rejects former host commands after abrupt disconnect grace window expires', async () => {
    // 1. Alice creates room
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Alice', roomId: 'race-room-2' },
    });
    const { token: aliceToken, memberId: aliceId } = JSON.parse(createRes.body);

    // 2. Bob joins room
    const joinRes = await app.inject({
      method: 'POST',
      url: '/api/rooms/race-room-2/join',
      payload: { name: 'Bob' },
    });
    const { token: bobToken, memberId: bobId } = JSON.parse(joinRes.body);

    const docBob = new Y.Doc();
    const clientBob = new SyncClient({
      url: `ws://127.0.0.1:${serverPort}/ws/rooms/race-room-2`,
      token: bobToken,
      doc: docBob,
    });

    // Connect Alice with raw socket so we can abruptly terminate it
    const aliceWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/race-room-2`, ['collab.v1', aliceToken]);
    await new Promise((resolve) => aliceWs.on('open', resolve));
    await clientBob.connect();
    await waitFor(() => clientBob.hostId === aliceId);
    expect(clientBob.hostId).toBe(aliceId);

    // Alice abruptly closes connection (no 'leave' message)
    aliceWs.terminate();

    // Inside grace window (100ms < 300ms grace), host remains Alice
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientBob.hostId).toBe(aliceId);

    // Wait until grace window expires (300ms grace) and Bob is elected
    await waitFor(() => clientBob.hostId === bobId);
    // Bob should now be elected host!
    expect(clientBob.hostId).toBe(bobId);

    // Alice reconnects with new socket and attempts host command
    const aliceWs2 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/race-room-2`, ['collab.v1', aliceToken]);
    await new Promise((resolve) => aliceWs2.on('open', resolve));

    let cmdResult: any = null;
    const reqId = crypto.randomUUID();
    aliceWs2.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.rid === reqId) {
          cmdResult = msg;
        }
      } catch {}
    });

    aliceWs2.send(JSON.stringify({ t: 'host.lock', rid: reqId, locked: true }));
    await waitFor(() => cmdResult !== null);

    expect(cmdResult).toEqual({
      t: 'error',
      rid: reqId,
      code: 'forbidden',
      message: 'Not host',
    });

    aliceWs2.close();
    clientBob.destroy();
  });

  it('disambiguates duplicate display names in welcome and pushes sliding token refresh', async () => {
    // 1. First user named Alice creates room
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Alice', roomId: 'dup-room' },
    });
    const { token: token1 } = JSON.parse(createRes.body);
    // Welcome lists present members only, so Alice must be connected.
    const aliceWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/dup-room`, ['collab.v1', token1]);
    await new Promise((resolve) => aliceWs.on('open', resolve));

    // 2. Second user also named "alice" joins
    const joinRes = await app.inject({
      method: 'POST',
      url: '/api/rooms/dup-room/join',
      payload: { name: 'alice' },
    });
    const { token: token2 } = JSON.parse(joinRes.body);

    // Connect second user via WebSocket
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/dup-room`, ['collab.v1', token2]);

    let welcomeMsg: any = null;
    const welcomePromise = new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.t === 'welcome') {
            welcomeMsg = msg;
            resolve();
          }
        } catch {}
      });
    });

    await new Promise((resolve) => ws.on('open', resolve));
    await Promise.race([
      welcomePromise,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);

    expect(welcomeMsg).not.toBeNull();
    // Names in members array should be disambiguated: "Alice" and "alice (2)"
    const names = welcomeMsg.members.map((m: any) => m.name);
    expect(names).toContain('Alice');
    expect(names).toContain('alice (2)');

    ws.close();
    aliceWs.close();
  });
});
