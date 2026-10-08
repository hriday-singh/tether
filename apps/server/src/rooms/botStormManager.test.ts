import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import ts from 'typescript';
import { BotStormManager, blockInsertAnchor, resolveInsertPos, waitForConvergence } from './botStormManager.js';
import { SNIPPETS_BY_LANG } from './botSnippets.js';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { AuditRepo } from '../repo/auditRepo.js';
import { ChatRepo } from '../repo/chatRepo.js';
import { JoinService } from '../services/joinService.js';
import { RoomService } from '../services/roomService.js';
import { AuditService } from '../services/auditService.js';
import { ChatService } from '../services/chatService.js';
import { PersistenceService } from '../services/persistenceService.js';
import { RoomRegistry } from './roomRegistry.js';
import { buildApp } from '../http/app.js';
import { createUpgradeGate } from '../ws/upgradeGate.js';
import { ServerConfig } from '../config.js';

describe('BotStormManager', () => {
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
  let manager: BotStormManager;

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
    TRUST_PROXY_HOPS: 0,
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

    manager = new BotStormManager({
      joinService,
      memberRepo,
      roomRepo,
      auditService,
      roomRegistry,
      chatService,
    });

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
    await manager.destroyAll();
    wss.close();
    roomRegistry.destroy();
    persistenceService.destroy();
    await app.close();
    db.close();
  });

  it('starts a storm, spawns bots, edits text, undos changes, and cleans up', async () => {
    await roomService.createRoom({ roomId: 'storm-room', creatorName: 'Host' });
    const loadedRoom = roomRegistry.getOrCreate('storm-room')!;

    // Pre-insert host text
    loadedRoom.doc.getText('codemirror').insert(0, '// Initial Host Code\n');
    const initialText = loadedRoom.doc.getText('codemirror').toString();

    expect(manager.isStormActive('storm-room')).toBe(false);

    // Start 1-second storm with 2 bots
    await manager.startStorm({
      roomId: 'storm-room',
      hostMemberId: 'host-1',
      bots: 2,
      seconds: 1,
      faults: false,
      port: serverPort,
    });

    expect(manager.isStormActive('storm-room')).toBe(true);

    // Concurrency guard: starting another storm in the same room throws
    await expect(
      manager.startStorm({
        roomId: 'storm-room',
        hostMemberId: 'host-1',
        bots: 1,
        seconds: 1,
        faults: false,
        port: serverPort,
      })
    ).rejects.toThrow(/already active/i);

    // Wait 1.5 seconds for storm to run, finish, and undo
    await new Promise((r) => setTimeout(r, 1500));

    expect(manager.isStormActive('storm-room')).toBe(false);

    // The text must cleanly revert back to the initial text
    const finalText = loadedRoom.doc.getText('codemirror').toString();
    expect(finalText).toBe(initialText);

    // Verify audit events recorded demo.storm_completed
    const events = auditService.getEventsAfter('storm-room', 0, 50);
    const completed = events.find((e) => e.type === 'demo.storm_completed');
    const payload = JSON.parse(String(completed?.payload)) as { converged: boolean; checksum: string; ops: number };
    expect(payload).toMatchObject({ converged: true, checksum: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(payload.ops).toBeGreaterThan(0);
  });

  it('supports early stopping via stopStorm() and supports faults mode', async () => {
    await roomService.createRoom({ roomId: 'faulty-room', creatorName: 'Host' });
    const loadedRoom = roomRegistry.getOrCreate('faulty-room')!;
    loadedRoom.doc.getText('codemirror').insert(0, '// Faulty Storm\n');
    const initialText = loadedRoom.doc.getText('codemirror').toString();

    await manager.startStorm({
      roomId: 'faulty-room',
      hostMemberId: 'host-1',
      bots: 2,
      seconds: 10, // long duration
      faults: true,
      port: serverPort,
    });

    expect(manager.isStormActive('faulty-room')).toBe(true);

    // Stop early after 400ms
    await new Promise((r) => setTimeout(r, 400));
    await manager.stopStorm('faulty-room');

    expect(manager.isStormActive('faulty-room')).toBe(false);
    const finalText = loadedRoom.doc.getText('codemirror').toString();
    expect(finalText).toBe(initialText);
  });

  it('destroys all active storms via destroyAll()', async () => {
    await roomService.createRoom({ roomId: 'destroy-room', creatorName: 'Host' });
    await manager.startStorm({
      roomId: 'destroy-room',
      hostMemberId: 'host-1',
      bots: 1,
      seconds: 10,
      faults: false,
      port: serverPort,
    });

    expect(manager.isStormActive('destroy-room')).toBe(true);
    await manager.destroyAll();
    expect(manager.isStormActive('destroy-room')).toBe(false);
  });

  it('waitForConvergence reports divergence when a replica differs after the timeout', async () => {
    const server = new Y.Doc();
    server.getText('codemirror').insert(0, 'same');
    const twin = new Y.Doc();
    Y.applyUpdate(twin, Y.encodeStateAsUpdate(server));
    expect((await waitForConvergence(server, [twin])).converged).toBe(true);

    const stray = new Y.Doc();
    stray.getText('codemirror').insert(0, 'different');
    expect((await waitForConvergence(server, [twin, stray])).converged).toBe(false);
  }, 10000);

  /** Two bots typing chunks into `text`, each block starting at the storm anchor like the manager does. */
  function botTyping(doc: Y.Doc) {
    const text = doc.getText('codemirror');
    const insertAt = blockInsertAnchor(text);
    const anchors: Record<'a' | 'b', Y.RelativePosition | null> = { a: null, b: null };
    return (bot: 'a' | 'b', chunk: string) => {
      const pos = resolveInsertPos(doc, anchors[bot] ?? insertAt)!;
      text.insert(pos, chunk);
      anchors[bot] = Y.createRelativePositionFromTypeIndex(text, pos + chunk.length, -1);
    };
  }

  it('keeps each block contiguous when bots type chunks concurrently', () => {
    const doc = new Y.Doc();
    const text = doc.getText('codemirror');
    text.insert(0, 'start\n');
    const type = botTyping(doc);
    // Interleaved chunks, plus a peer prepending text, used to scramble stale integer offsets.
    for (let i = 0; i < 3; i++) {
      type('a', 'AAA');
      text.insert(0, '#');
      type('b', 'bbb');
    }
    // b started later, so it sits above a (the manager feeds its queue in reverse to match).
    expect(text.toString()).toBe('###start\nbbbbbbbbbAAAAAAAAA');
  });

  it('keeps concurrent replicas from splicing one block into another', () => {
    const server = new Y.Doc();
    server.getText('codemirror').insert(0, 'x\n');
    const [a, b] = [new Y.Doc(), new Y.Doc()];
    for (const d of [a, b]) Y.applyUpdate(d, Y.encodeStateAsUpdate(server));
    const insertAt = blockInsertAnchor(server.getText('codemirror'));
    const typeIn = (d: Y.Doc, chunk: string, anchor: Y.RelativePosition | null) => {
      const t = d.getText('codemirror');
      const pos = resolveInsertPos(d, anchor ?? insertAt)!;
      t.insert(pos, chunk);
      return Y.createRelativePositionFromTypeIndex(t, pos + chunk.length, -1);
    };
    const sync = () => {
      for (const d of [a, b]) Y.applyUpdate(server, Y.encodeStateAsUpdate(d));
      for (const d of [a, b]) Y.applyUpdate(d, Y.encodeStateAsUpdate(server));
    };
    let anchorA = typeIn(a, 'A1', null);
    sync();
    // b starts a block while a types its next chunk, neither seeing the other's edit yet.
    typeIn(b, 'B1', null);
    anchorA = typeIn(a, 'A2', anchorA);
    sync();
    expect(server.getText('codemirror').toString()).toBe('x\nB1A1A2');
  });

  it('types HTML blocks above </body>, in reverse start order, and waits for an unsynced replica', () => {
    const doc = new Y.Doc();
    const text = doc.getText('codemirror');
    text.insert(0, '<html>\n  <body>\n    <h1>Hi</h1>\n  </body>\n</html>\n');
    const type = botTyping(doc);
    type('a', '    <p>');
    type('b', '    <hr>\n');
    type('a', 'A</p>\n');
    expect(text.toString()).toBe('<html>\n  <body>\n    <h1>Hi</h1>\n    <hr>\n    <p>A</p>\n  </body>\n</html>\n');
    expect(blockInsertAnchor(new Y.Doc().getText('codemirror'))).toBeNull();
    expect(resolveInsertPos(new Y.Doc(), blockInsertAnchor(text))).toBeNull();
  });

  it('ships JavaScript and TypeScript blocks that compile on their own and together', () => {
    for (const lang of ['javascript', 'typescript'] as const) {
      const whole = SNIPPETS_BY_LANG[lang]!.map((s) => s.code).join('');
      const out = ts.transpileModule(whole, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
      expect(out.diagnostics ?? [], lang).toEqual([]);
      if (lang === 'javascript') expect(() => new Function(whole)).not.toThrow();
    }
  });
});
