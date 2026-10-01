import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openApiSpec } from './openapi.js';
import { buildApp } from './app.js';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { AuditRepo } from '../repo/auditRepo.js';
import { JoinService } from '../services/joinService.js';
import { RoomService } from '../services/roomService.js';
import { AuditService } from '../services/auditService.js';
import { ChatService } from '../services/chatService.js';
import { ChatRepo } from '../repo/chatRepo.js';
import { PersistenceService } from '../services/persistenceService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { ServerConfig } from '../config.js';

describe('OpenAPI 3.1.0 Specification', () => {
  let db: DatabaseSession;
  let app: FastifyInstance;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const roomRepo = new RoomRepo(db);
    const updateRepo = new UpdateRepo(db);
    const memberRepo = new MemberRepo(db);
    const auditRepo = new AuditRepo(db);
    const joinService = new JoinService('test_secret_at_least_32_chars_long!!');
    const auditService = new AuditService(auditRepo);
    const chatService = new ChatService(new ChatRepo(db));
    const roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    const persistenceService = new PersistenceService(updateRepo, roomRepo, 100);
    const roomRegistry = new RoomRegistry(roomRepo, updateRepo, persistenceService, auditService, 30000);

    const config: ServerConfig = {
      PORT: 0,
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      JWT_SECRET: 'test_secret_at_least_32_chars_long!!',
      ALLOWED_ORIGINS: ['http://localhost:3000'],
      DATABASE_DRIVER: 'sqlite',
      SQLITE_PATH: ':memory:',
      HOST_GRACE_MS: 5000,
      PERSIST_FLUSH_MS: 100,
      ROOM_UNLOAD_IDLE_MS: 30000,
      TRUST_PROXY_HOPS: 0,
      DEMO_MODE: false,
    };

    app = buildApp({
      config,
      roomService,
      joinService,
      auditService,
      roomRegistry,
      roomRepo,
      memberRepo,
      chatService,
      persistenceService,
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('has valid OpenAPI 3.1.0 structure with all core endpoints documented', () => {
    expect(openApiSpec.openapi).toBe('3.1.0');
    expect(openApiSpec.info).toBeDefined();
    const paths = openApiSpec.paths as Record<string, unknown>;
    expect(paths['/api/rooms']).toBeDefined();
    expect(paths['/api/rooms/{id}']).toBeDefined();
    expect(paths['/api/rooms/{id}/join']).toBeDefined();
    expect(paths['/api/rooms/{id}/admission']).toBeDefined();
    expect(paths['/api/rooms/{id}/events']).toBeDefined();
    expect(paths['/api/rooms/{id}/chat']).toBeDefined();
    expect(paths['/health/live']).toBeDefined();
    expect(paths['/health/ready']).toBeDefined();
    expect(paths['/metrics']).toBeDefined();
  });

  it('serves openapi spec via GET /docs/openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual(openApiSpec);
  });

  it('matches static docs/openapi.json on disk', () => {
    const diskPath = existsSync(resolve(process.cwd(), 'docs/openapi.json'))
      ? resolve(process.cwd(), 'docs/openapi.json')
      : resolve(process.cwd(), '../../docs/openapi.json');
    const diskContent = JSON.parse(readFileSync(diskPath, 'utf-8'));
    expect(diskContent).toEqual(openApiSpec);
  });
});
