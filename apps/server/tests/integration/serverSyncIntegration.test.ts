import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
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
import type { ChatMessage, AuditEvent } from '@tether/shared/protocol/schemas';

describe('End-to-End Real-Time ServerSyncClient Integration', () => {
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
    HOST_GRACE_MS: 5000,
    PERSIST_FLUSH_MS: 50,
    ROOM_UNLOAD_IDLE_MS: 30000,
    TRUST_PROXY_HOPS: 0,
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
    persistenceService = new PersistenceService(updateRepo, roomRepo, 50);
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
    const address = app.server.address();
    serverPort = typeof address === 'object' && address !== null ? address.port : 0;
  });

  afterEach(async () => {
    wss.close();
    roomRegistry.destroy();
    persistenceService.destroy();
    await app.close();
    db.close();
  });

  it('synchronizes real-time text edits, awareness, chat, and host commands between two clients', async () => {
    const roomId = 'sync-e2e-room';

    // 1. Alice creates the room via REST
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Alice', roomId },
    });
    expect(createRes.statusCode).toBe(201);
    const aliceData = JSON.parse(createRes.payload) as { token: string; memberId: string };

    // 2. Bob joins the room via REST
    const joinRes = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/join`,
      payload: { name: 'Bob' },
    });
    expect(joinRes.statusCode).toBe(200);
    const bobData = JSON.parse(joinRes.payload) as { token: string; memberId: string };

    // 3. Instantiate two clients with distinct Y.Docs and Awareness
    const aliceDoc = new Y.Doc();
    const bobDoc = new Y.Doc();

    const aliceText = aliceDoc.getText('codemirror');
    const bobText = bobDoc.getText('codemirror');

    const aliceReceivedChats: ChatMessage[] = [];
    const bobReceivedChats: ChatMessage[] = [];
    const bobReceivedEvents: AuditEvent[] = [];
    let bobReceivedRoomUpdate: { locked?: boolean } | null = null;
    let bobReceivedHostId: string | null = null;
    let bobReceivedAwarenessBytes: Uint8Array | null = null;

    const wsUrl = `ws://127.0.0.1:${serverPort}/ws/rooms/${roomId}`;

    const aliceClient = new SyncClient({
      url: wsUrl,
      token: aliceData.token,
      doc: aliceDoc,
      webSocketFactory: (u, p) => new WebSocket(u, p),
      onChat: (msg) => aliceReceivedChats.push(msg),
    });

    const bobClient = new SyncClient({
      url: wsUrl,
      token: bobData.token,
      doc: bobDoc,
      webSocketFactory: (u, p) => new WebSocket(u, p),
      onChat: (msg) => bobReceivedChats.push(msg),
      onEvent: (event) => bobReceivedEvents.push(event),
      onRoomUpdate: (settings) => {
        bobReceivedRoomUpdate = settings;
      },
      onHostChange: (newHostId) => {
        bobReceivedHostId = newHostId;
      },
      onAwarenessUpdate: (bytes) => {
        bobReceivedAwarenessBytes = bytes;
      },
    });

    // 4. Connect both clients
    await Promise.all([aliceClient.connect(), bobClient.connect()]);

    // Give connection a brief moment to complete initial sync handshake
    await new Promise((r) => setTimeout(r, 100));

    // 5. Test collaborative text sync (Alice types, Bob receives)
    aliceText.insert(0, 'const greeting = "Hello Tether";\n');
    aliceClient.flushBatch();

    // Wait for Bob to receive update
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Bob doc sync')), 3000);
      const observer = () => {
        if (bobText.toString().includes('Hello Tether')) {
          bobText.unobserve(observer);
          clearTimeout(timeout);
          resolve();
        }
      };
      if (bobText.toString().includes('Hello Tether')) {
        clearTimeout(timeout);
        resolve();
      } else {
        bobText.observe(observer);
      }
    });

    expect(bobText.toString()).toBe('const greeting = "Hello Tether";\n');

    // Bob appends text and flushes
    bobText.insert(bobText.length, 'console.log(greeting);\n');
    bobClient.flushBatch();

    // Wait for Alice to receive Bob's update
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Alice doc sync')), 3000);
      const observer = () => {
        if (aliceText.toString().includes('console.log(greeting);')) {
          aliceText.unobserve(observer);
          clearTimeout(timeout);
          resolve();
        }
      };
      if (aliceText.toString().includes('console.log(greeting);')) {
        clearTimeout(timeout);
        resolve();
      } else {
        aliceText.observe(observer);
      }
    });

    expect(aliceText.toString()).toBe('const greeting = "Hello Tether";\nconsole.log(greeting);\n');
    expect(bobText.toString()).toBe(aliceText.toString());

    // 6. Test Awareness propagation
    const aliceAwareness = new awarenessProtocol.Awareness(aliceDoc);
    aliceAwareness.setLocalState({
      memberId: aliceData.memberId,
      cursor: null,
      highlight: null,
      typing: true,
      status: 'active',
    });
    const awUpdate = awarenessProtocol.encodeAwarenessUpdate(aliceAwareness, [aliceDoc.clientID]);
    aliceClient.queueAwarenessUpdate(awUpdate);
    aliceClient.flushBatch();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for awareness update')), 3000);
      const interval = setInterval(() => {
        if (bobReceivedAwarenessBytes && bobReceivedAwarenessBytes.byteLength > 0) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 50);
    });

    expect(bobReceivedAwarenessBytes).not.toBeNull();

    // 7. Test Text Chat live delivery & REST history
    const clientMsgId = '33333333-3333-3333-3333-333333333333';
    await aliceClient.command({
      t: 'chat.send',
      rid: clientMsgId,
      text: 'Hey Bob, does this compile?',
    });

    // Wait for Bob to receive chat message live
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Bob chat message')), 3000);
      const interval = setInterval(() => {
        if (bobReceivedChats.some((c) => c.text === 'Hey Bob, does this compile?')) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 50);
    });

    expect(bobReceivedChats).toHaveLength(1);
    expect(bobReceivedChats[0]!.name).toBe('Alice');
    expect(bobReceivedChats[0]!.seq).toBe(1);

    // Verify chat message persisted in REST endpoint GET /api/rooms/:id/chat
    const chatRestRes = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/chat`,
      headers: {
        authorization: `Bearer ${bobData.token}`,
      },
    });
    expect(chatRestRes.statusCode).toBe(200);
    const chatPage = JSON.parse(chatRestRes.payload) as { items: ChatMessage[] };
    expect(chatPage.items).toHaveLength(1);
    expect(chatPage.items[0]!.text).toBe('Hey Bob, does this compile?');
    expect(chatPage.items[0]!.seq).toBe(1);

    // 8. Test Host Commands (Lock room)
    const lockRid = '44444444-4444-4444-4444-444444444444';
    await aliceClient.command({
      t: 'host.lock',
      rid: lockRid,
      locked: true,
    });

    // Wait for Bob to receive room.updated control message and room.locked audit event
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for Bob room.updated')), 3000);
      const interval = setInterval(() => {
        if (bobReceivedRoomUpdate && bobReceivedRoomUpdate.locked === true) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 50);
    });

    expect(bobReceivedRoomUpdate).toEqual({ locked: true });
    expect(bobReceivedEvents.some((e) => e.type === 'room.locked')).toBe(true);

    // Clean up clients
    aliceClient.destroy();
    bobClient.destroy();
    aliceDoc.destroy();
    bobDoc.destroy();
    aliceAwareness.destroy();
  });
});
