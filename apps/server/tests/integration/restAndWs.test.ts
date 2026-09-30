import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
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
import { SyncClient } from '@tether/sync-client';
import { ServerConfig } from '../../src/config.js';
import { encodeFrame } from '@tether/shared/protocol/codec';
import { FRAME_KINDS } from '@tether/shared/constants';

describe('Server HTTP REST & WebSocket Integration', () => {
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
    ALLOWED_ORIGINS: ['http://localhost:3000', 'http://127.0.0.1:3000'],
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

  describe('REST Endpoints', () => {
    it('returns health live and ready', async () => {
      const resLive = await app.inject({ method: 'GET', url: '/health/live' });
      expect(resLive.statusCode).toBe(200);
      expect(JSON.parse(resLive.payload)).toEqual({ status: 'ok' });

      const resReady = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(resReady.statusCode).toBe(200);
      expect(JSON.parse(resReady.payload)).toHaveProperty('activeRooms');
    });

    it('creates room, joins with passcode, and retrieves room details', async () => {
      // 1. Create room with passcode
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { 'Idempotency-Key': 'key-1' },
        payload: {
          name: 'Alice',
          roomId: 'demo-test',
          passcode: 'secret123',
          language: 'typescript',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.payload);
      expect(created.room.id).toBe('demo-test');
      expect(created.room.hasPasscode).toBe(true);

      // 2. Fetch room info
      const infoRes = await app.inject({ method: 'GET', url: '/api/rooms/demo-test' });
      expect(infoRes.statusCode).toBe(200);
      const info = JSON.parse(infoRes.payload);
      expect(info.hasPasscode).toBe(true);
      expect(info.language).toBe('typescript');

      // 3. Join with bad passcode -> 401
      const badJoin = await app.inject({
        method: 'POST',
        url: '/api/rooms/demo-test/join',
        payload: { name: 'Bob', passcode: 'wrong' },
      });
      expect(badJoin.statusCode).toBe(401);

      // 4. Join with correct passcode -> 200
      const goodJoin = await app.inject({
        method: 'POST',
        url: '/api/rooms/demo-test/join',
        payload: { name: 'Bob', passcode: 'secret123' },
      });
      expect(goodJoin.statusCode).toBe(200);
      const bobData = JSON.parse(goodJoin.payload);
      expect(bobData.token).toBeDefined();

      // 5. Test admission probe with valid token
      const admRes = await app.inject({
        method: 'GET',
        url: '/api/rooms/demo-test/admission',
        headers: { authorization: `Bearer ${bobData.token}` },
      });
      expect(admRes.statusCode).toBe(200);
      expect(JSON.parse(admRes.payload)).toEqual({ status: 'ok' });

      // 6. Test events endpoint: verify camelCase schema and cursors
      const eventsRes = await app.inject({
        method: 'GET',
        url: '/api/rooms/demo-test/events',
        headers: { authorization: `Bearer ${bobData.token}` },
      });
      expect(eventsRes.statusCode).toBe(200);
      const eventsData = JSON.parse(eventsRes.payload);
      expect(Array.isArray(eventsData.items)).toBe(true);
      expect(eventsData).toHaveProperty('nextBefore');
      expect(eventsData).toHaveProperty('nextAfter');
      if (eventsData.items.length > 0) {
        const firstEvent = eventsData.items[0];
        expect(firstEvent).toHaveProperty('roomId');
        expect(firstEvent).not.toHaveProperty('room_id');
        expect(firstEvent).toHaveProperty('createdAt');
        expect(firstEvent).not.toHaveProperty('created_at');
        expect(firstEvent.roomId).toBe('demo-test');
      }

      // 7. Test admission probe with stale passcode version
      roomRepo.updateSettings('demo-test', { passcodeVersion: 99 });
      const staleAdmRes = await app.inject({
        method: 'GET',
        url: '/api/rooms/demo-test/admission',
        headers: { authorization: `Bearer ${bobData.token}` },
      });
      expect(staleAdmRes.statusCode).toBe(200);
      expect(JSON.parse(staleAdmRes.payload)).toEqual({ status: 'reauth' });
    });
  });

  describe('WebSocket Upgrade & Synchronization', () => {
    it('synchronizes edits between two clients in real-time', async () => {
      // Create room
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'Alice', roomId: 'sync-room' },
      });
      const aliceData = JSON.parse(createRes.payload);

      // Bob joins
      const bobRes = await app.inject({
        method: 'POST',
        url: '/api/rooms/sync-room/join',
        payload: { name: 'Bob' },
      });
      const bobData = JSON.parse(bobRes.payload);

      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/rooms/sync-room`;

      const doc1 = new Y.Doc();
      const client1 = new SyncClient({
        url: wsUrl,
        token: aliceData.token,
        doc: doc1,
        webSocketFactory: (u, p) => new WebSocket(u, p),
      });

      const doc2 = new Y.Doc();
      const client2 = new SyncClient({
        url: wsUrl,
        token: bobData.token,
        doc: doc2,
        webSocketFactory: (u, p) => new WebSocket(u, p),
      });

      // Connect both clients
      client1.connect();
      client2.connect();

      // Wait for connection
      await new Promise<void>((resolve) => {
        let connectedCount = 0;
        const check = () => {
          connectedCount++;
          if (connectedCount === 2) resolve();
        };
        client1.doc.on('update', () => {});
        // Poll connection state
        const interval = setInterval(() => {
          if (client1.connectionStatus === 'connected' && client2.connectionStatus === 'connected') {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });

      // Alice types in editor
      doc1.getText('codemirror').insert(0, 'const x = 42;');

      // Wait for Bob to receive the text
      await new Promise<void>((resolve) => {
        doc2.getText('codemirror').observe(() => {
          if (doc2.getText('codemirror').toString() === 'const x = 42;') {
            resolve();
          }
        });
      });

      expect(doc2.getText('codemirror').toString()).toBe('const x = 42;');

      // Bob appends text
      doc2.getText('codemirror').insert(13, '\nconsole.log(x);');

      // Wait for Alice to converge
      await new Promise<void>((resolve) => {
        doc1.getText('codemirror').observe(() => {
          if (doc1.getText('codemirror').toString().includes('console.log(x);')) {
            resolve();
          }
        });
      });

      // Invariant I1: Convergence! Both documents are byte-identical
      expect(doc1.getText('codemirror').toString()).toBe(doc2.getText('codemirror').toString());

      client1.destroy();
      client2.destroy();
    });

    it('broadcasts audit events in real-time and populates welcome token and eventSeq', async () => {
      // 1. Create room
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'HostAlice', roomId: 'event-room' },
      });
      const aliceData = JSON.parse(createRes.payload);

      // Connect raw WebSocket for Alice
      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/rooms/event-room`;
      const ws = new WebSocket(wsUrl, ['collab.v1', aliceData.token]);

      let welcomeReceived: any = null;
      const eventsReceived: any[] = [];

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for event'));
        }, 3000);

        ws.on('open', () => {
          // Send SYNC_STEP1 so server responds
          const step1 = encodeFrame({
            kind: FRAME_KINDS.SYNC_STEP1,
            stateVector: Y.encodeStateVector(new Y.Doc()),
          });
          ws.send(step1);
        });

        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            const text = data.toString();
            const msg = JSON.parse(text);
            if (msg.t === 'welcome') {
              welcomeReceived = msg;
              // Now issue host.lock command
              ws.send(
                JSON.stringify({
                  t: 'host.lock',
                  rid: '11111111-1111-1111-1111-111111111111',
                  locked: true,
                })
              );
            } else if (msg.t === 'event') {
              eventsReceived.push(msg.event);
              if (msg.event.type === 'room.locked') {
                clearTimeout(timeout);
                resolve();
              }
            }
          }
        });

        ws.on('error', (err) => {
          reject(err);
        });
      });

      expect(welcomeReceived).not.toBeNull();
      expect(welcomeReceived.token).toBeTruthy();
      expect(welcomeReceived.eventSeq).toBeGreaterThanOrEqual(1);

      expect(eventsReceived.length).toBeGreaterThanOrEqual(1);
      const lockedEvent = eventsReceived.find((e: any) => e.type === 'room.locked');
      expect(lockedEvent).toBeDefined();
      expect(lockedEvent.roomId).toBe('event-room');
      expect(lockedEvent.actorMemberId).toBe(aliceData.memberId);

      ws.close();
    });

    it('stores, broadcasts, rate-limits and serves chat messages (ADR-017)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'HostAlice', roomId: 'chat-room' },
      });
      const alice = JSON.parse(createRes.payload) as { token: string };
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/chat-room`, ['collab.v1', alice.token]);
      const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

      let chatSeqAtWelcome = -1;
      const oks: string[] = [];
      const errors: Array<{ rid: string; code: string }> = [];
      const chats: Array<{ seq: number; text: string; clientMsgId: string }> = [];

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for chat replies')), 3000);
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const msg = JSON.parse(data.toString()) as { t: string; [k: string]: unknown };
          if (msg.t === 'welcome') {
            chatSeqAtWelcome = msg.chatSeq as number;
            // Burst is 5: the 6th message inside one second must be rejected without closing the socket.
            for (let i = 1; i <= 6; i++) ws.send(JSON.stringify({ t: 'chat.send', rid: rid(i), text: `  hi ${i}  ` }));
          } else if (msg.t === 'ok') oks.push(msg.rid as string);
          else if (msg.t === 'error') errors.push({ rid: msg.rid as string, code: msg.code as string });
          else if (msg.t === 'chat.msg') chats.push(msg.message as (typeof chats)[number]);
          if (oks.length + errors.length === 6 && chats.length === 5) {
            clearTimeout(timeout);
            resolve();
          }
        });
        ws.on('error', reject);
      });

      expect(chatSeqAtWelcome).toBe(0);
      expect(oks).toHaveLength(5);
      expect(errors).toEqual([{ rid: rid(6), code: 'rate_limited' }]);
      expect(chats.map((c) => c.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(chats[0]!.text).toBe('hi 1');
      expect(ws.readyState).toBe(WebSocket.OPEN);

      const page = await app.inject({
        method: 'GET',
        url: '/api/rooms/chat-room/chat?limit=2',
        headers: { authorization: `Bearer ${alice.token}` },
      });
      expect(page.statusCode).toBe(200);
      const body = JSON.parse(page.payload) as { items: Array<{ seq: number }>; nextBefore: number | null };
      expect(body.items.map((m) => m.seq)).toEqual([5, 4]);
      expect(body.nextBefore).toBe(4);

      const after = await app.inject({
        method: 'GET',
        url: '/api/rooms/chat-room/chat?after=3',
        headers: { authorization: `Bearer ${alice.token}` },
      });
      expect((JSON.parse(after.payload) as { items: Array<{ seq: number }> }).items.map((m) => m.seq)).toEqual([4, 5]);

      const bad = await app.inject({
        method: 'GET',
        url: '/api/rooms/chat-room/chat?limit=abc',
        headers: { authorization: `Bearer ${alice.token}` },
      });
      expect(bad.statusCode).toBe(400);

      const anon = await app.inject({ method: 'GET', url: '/api/rooms/chat-room/chat' });
      expect(anon.statusCode).toBe(401);

      ws.close();
    });

    it('broadcasts member.joined when peer connects and member.left on clean leave', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'Alice', roomId: 'roster-room' },
      });
      const aliceData = JSON.parse(createRes.payload) as { token: string };

      const joinRes = await app.inject({
        method: 'POST',
        url: '/api/rooms/roster-room/join',
        payload: { name: 'Bob' },
      });
      const bobData = JSON.parse(joinRes.payload) as { token: string; memberId: string };

      const wsAlice = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/roster-room`, ['collab.v1', aliceData.token]);

      let aliceSawBobJoin = false;
      let aliceSawBobLeave = false;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for Alice welcome')), 3000);
        wsAlice.on('message', (data, isBinary) => {
          if (!isBinary) {
            const msg = JSON.parse(data.toString());
            if (msg.t === 'welcome') {
              clearTimeout(timeout);
              resolve();
            }
          }
        });
        wsAlice.on('error', reject);
      });

      // Now Bob connects
      const wsBob = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/roster-room`, ['collab.v1', bobData.token]);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for Bob joined broadcast')), 3000);
        wsAlice.on('message', (data, isBinary) => {
          if (!isBinary) {
            const msg = JSON.parse(data.toString());
            if (msg.t === 'member.joined' && msg.member.name === 'Bob') {
              aliceSawBobJoin = true;
              clearTimeout(timeout);
              resolve();
            }
          }
        });
        wsBob.on('error', reject);
      });

      expect(aliceSawBobJoin).toBe(true);

      // Bob cleanly leaves
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for Bob left broadcast')), 3000);
        wsAlice.on('message', (data, isBinary) => {
          if (!isBinary) {
            const msg = JSON.parse(data.toString());
            if (msg.t === 'member.left' && msg.memberId === bobData.memberId) {
              aliceSawBobLeave = true;
              clearTimeout(timeout);
              resolve();
            }
          }
        });
        wsBob.send(JSON.stringify({ t: 'leave' }));
      });

      expect(aliceSawBobLeave).toBe(true);

      wsAlice.close();
      wsBob.close();
    });

    it('rejects demo.storm when DEMO_MODE is false', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'HostAlice', roomId: 'storm-room' },
      });
      const alice = JSON.parse(createRes.payload) as { token: string };
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/rooms/storm-room`, ['collab.v1', alice.token]);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for storm reply')), 3000);
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const msg = JSON.parse(data.toString());
          if (msg.t === 'welcome') {
            ws.send(
              JSON.stringify({
                t: 'demo.storm',
                rid: '22222222-2222-2222-2222-222222222222',
                bots: 3,
                seconds: 15,
                faults: true,
              })
            );
          } else if (msg.t === 'error' && msg.rid === '22222222-2222-2222-2222-222222222222') {
            expect(msg.code).toBe('forbidden');
            clearTimeout(timeout);
            resolve();
          }
        });
        ws.on('error', reject);
      });

      ws.close();
    });
  });
});
