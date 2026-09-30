import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as crypto from 'node:crypto';
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
import { BotStormManager } from '../../src/rooms/botStormManager.js';
import { buildApp } from '../../src/http/app.js';
import { createUpgradeGate } from '../../src/ws/upgradeGate.js';
import { SyncClient } from '@tether/sync-client';
import { ServerConfig } from '../../src/config.js';
import type { Member } from '@tether/shared/protocol/schemas';

describe('Bot Storm Spawner WebSocket Integration', () => {
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
  let botStormManager: BotStormManager;

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
    PERSIST_FLUSH_MS: 50,
    ROOM_UNLOAD_IDLE_MS: 30000,
    DEMO_MODE: true,
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
    botStormManager = new BotStormManager({
      joinService,
      memberRepo,
      roomRepo,
      auditService,
      roomRegistry,
    });

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
      botStormManager,
      serverPort: 0,
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
    deps.serverPort = serverPort;
  });

  afterEach(async () => {
    await botStormManager.destroyAll();
    wss.close();
    roomRegistry.destroy();
    persistenceService.destroy();
    await app.close();
    db.close();
  });

  it(
    'triggers a bot storm via demo.storm, spawns bots, streams edits, and restores doc cleanly',
    async () => {
    const { room, token: hostToken } = await roomService.createRoom({
      roomId: 'ws-storm-room',
      creatorName: 'StormHost',
    });

    const hostDoc = new Y.Doc();
    hostDoc.getText('codemirror').insert(0, 'console.log("clean host state");\n');
    const expectedInitialText = hostDoc.getText('codemirror').toString();

    let currentRoster: Member[] = [];
    const completedEvents: unknown[] = [];

    const hostClient = new SyncClient({
      url: `ws://127.0.0.1:${serverPort}/ws/rooms/${room.id}`,
      token: hostToken,
      doc: hostDoc,
      webSocketFactory: (url, protocols) => new WebSocket(url, protocols),
      onRosterChange: (roster) => {
        currentRoster = roster;
      },
      onEvent: (event) => {
        if (event.type === 'demo.storm_completed') {
          completedEvents.push(event);
        }
      },
    });

    await hostClient.connect();

    // Wait for connection and welcome
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (hostClient.status === 'connected') {
          clearInterval(interval);
          resolve();
        }
      }, 25);
    });

    expect(currentRoster.length).toBe(1);
    expect(currentRoster[0]?.name).toBe('StormHost');

    // Trigger storm: 2 bots, 1 second
    const stormRid = crypto.randomUUID();
    await hostClient.command({
      t: 'demo.storm',
      rid: stormRid,
      bots: 2,
      seconds: 1,
      faults: false,
    });

    // Verify bots join the room roster and are marked with isBot: true
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (currentRoster.length >= 3) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    expect(currentRoster.length).toBe(3);
    const botMembers = currentRoster.filter((m) => m.isBot);
    expect(botMembers.length).toBe(2);

    // Concurrency guard: sending demo.storm again returns error
    const secondStormRid = crypto.randomUUID();
    await expect(
      hostClient.command({
        t: 'demo.storm',
        rid: secondStormRid,
        bots: 1,
        seconds: 1,
        faults: false,
      })
    ).rejects.toThrow();

    // Wait for storm completion
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (completedEvents.length > 0 && !botStormManager.isStormActive('ws-storm-room')) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    // Small delay for undos and disconnects to settle
    await new Promise((r) => setTimeout(r, 300));

    // The host text must be cleanly restored to its initial state
    const finalText = hostDoc.getText('codemirror').toString();
    expect(finalText).toBe(expectedInitialText);

    // Bots have disconnected from the roster
    expect(currentRoster.filter((m) => m.isBot).length).toBe(0);

    hostClient.destroy();
  }, 15000);

  it('rejects demo.storm from non-host member with forbidden', async () => {
    const { room, token: hostToken } = await roomService.createRoom({
      roomId: 'nonhost-room',
      creatorName: 'HostUser',
    });

    const hostDoc = new Y.Doc();
    const hostClient = new SyncClient({
      url: `ws://127.0.0.1:${serverPort}/ws/rooms/${room.id}`,
      token: hostToken,
      doc: hostDoc,
      webSocketFactory: (url, protocols) => new WebSocket(url, protocols),
    });
    await hostClient.connect();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (hostClient.status === 'connected') {
          clearInterval(interval);
          resolve();
        }
      }, 25);
    });

    const guestToken = await joinService.issueRoomToken({
      roomId: 'nonhost-room',
      memberId: 'guest-1',
      displayName: 'GuestUser',
      passcodeVersion: 0,
      roomEpoch: room.epoch,
    });

    const guestDoc = new Y.Doc();
    const guestClient = new SyncClient({
      url: `ws://127.0.0.1:${serverPort}/ws/rooms/${room.id}`,
      token: guestToken,
      doc: guestDoc,
      webSocketFactory: (url, protocols) => new WebSocket(url, protocols),
    });

    await guestClient.connect();
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (guestClient.status === 'connected') {
          clearInterval(interval);
          resolve();
        }
      }, 25);
    });

    await expect(
      guestClient.command({
        t: 'demo.storm',
        rid: crypto.randomUUID(),
        bots: 2,
        seconds: 1,
        faults: false,
      })
    ).rejects.toThrow(/forbidden/i);

    guestClient.destroy();
    hostClient.destroy();
  });

  it('rejects demo.storm if DEMO_MODE is false', async () => {
    mockConfig.DEMO_MODE = false;

    const { room, token: hostToken } = await roomService.createRoom({
      roomId: 'nodemo-room',
      creatorName: 'HostUser',
    });

    const hostDoc = new Y.Doc();
    const hostClient = new SyncClient({
      url: `ws://127.0.0.1:${serverPort}/ws/rooms/${room.id}`,
      token: hostToken,
      doc: hostDoc,
      webSocketFactory: (url, protocols) => new WebSocket(url, protocols),
    });
    await hostClient.connect();

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (hostClient.status === 'connected') {
          clearInterval(interval);
          resolve();
        }
      }, 25);
    });

    await expect(
      hostClient.command({
        t: 'demo.storm',
        rid: crypto.randomUUID(),
        bots: 2,
        seconds: 1,
        faults: false,
      })
    ).rejects.toThrow(/forbidden/i);

    hostClient.destroy();
    mockConfig.DEMO_MODE = true;
  });
});
