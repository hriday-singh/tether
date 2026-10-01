import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { clearAllRateLimiters } from '../../src/http/rateLimiter.js';
import { ServerConfig } from '../../src/config.js';

describe('HTTP REST Rate Limiting Integration', () => {
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
    TRUST_PROXY_HOPS: 0,
    DEMO_MODE: false,
  };

  beforeEach(async () => {
    clearAllRateLimiters();
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    memberRepo = new MemberRepo(db);
    auditRepo = new AuditRepo(db);

    joinService = new JoinService(mockConfig.JWT_SECRET);
    auditService = new AuditService(auditRepo);
    const chatService = new ChatService(new ChatRepo(db));
    roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    persistenceService = new PersistenceService(updateRepo, roomRepo, 100);
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
  });

  afterEach(async () => {
    roomRegistry.destroy();
    persistenceService.destroy();
    await app.close();
    db.close();
  });

  it('rate limits POST /api/rooms at 10 requests per IP burst', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'Alice' },
      });
      expect(res.statusCode).toBe(201);
    }

    const rateLimited = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Alice' },
    });
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.json().error.code).toBe('rate_limited');
    expect(rateLimited.headers['retry-after']).toBeDefined();
  });

  it('rate limits POST /api/rooms/:id/join at 5 requests per (IP + roomId)', async () => {
    await roomService.createRoom({ roomId: 'target-room', creatorName: 'Host' });

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms/target-room/join',
        payload: { name: `Guest${i}` },
      });
      expect(res.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/rooms/target-room/join',
      payload: { name: 'GuestBlocked' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
