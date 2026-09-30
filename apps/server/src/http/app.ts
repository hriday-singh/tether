import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { ServerConfig } from '../config.js';
import { RoomService } from '../services/roomService.js';
import { JoinService } from '../services/joinService.js';
import { AuditService } from '../services/auditService.js';
import { ChatService } from '../services/chatService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { formatAuditEventRow } from '../repo/auditRepo.js';
import { getIsDraining } from '../ws/upgradeGate.js';
import { MAX_MEMBERS_PER_ROOM } from '@tether/shared/constants';

import { PersistenceService } from '../services/persistenceService.js';
import { createRateLimitHook, defaultIpKeyExtractor } from './rateLimiter.js';
import { openApiSpec } from './openapi.js';

export interface AppDependencies {
  config: ServerConfig;
  roomService: RoomService;
  joinService: JoinService;
  auditService: AuditService;
  chatService: ChatService;
  roomRegistry: RoomRegistry;
  roomRepo: RoomRepo;
  memberRepo: MemberRepo;
  persistenceService?: PersistenceService;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  // Enable CORS
  app.register(cors, {
    origin: deps.config.ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  // Centralized standard error handler
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: {
        code: error.code ?? 'internal_server_error',
        message: error.message || 'An unexpected error occurred',
      },
    });
  });

  // Health checks
  app.get('/health/live', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });

  app.get('/health/ready', async (_req, reply) => {
    if (getIsDraining()) {
      return reply.status(503).send({ status: 'draining' });
    }
    if (deps.persistenceService?.isBufferFull()) {
      return reply.status(503).send({ status: 'buffer_full' });
    }
    return reply.send({ status: 'ready', activeRooms: deps.roomRegistry.activeRoomCount });
  });

  app.get('/metrics', async (_req, reply) => {
    return reply.send({
      activeRooms: deps.roomRegistry.activeRoomCount,
      timestamp: Date.now(),
    });
  });

  app.get('/docs/openapi.json', async (_req, reply) => {
    return reply.header('Content-Type', 'application/json').send(openApiSpec);
  });

  // Rate Limiters
  const roomCreateLimiter = createRateLimitHook({
    ratePerSec: 10 / 60,
    burst: 10,
  });

  const roomGetLimiter = createRateLimitHook({
    ratePerSec: 1,
    burst: 60,
  });

  const joinLimiter = createRateLimitHook({
    ratePerSec: 5 / 60,
    burst: 5,
    keyExtractor: (req) => {
      const ip = defaultIpKeyExtractor(req);
      const roomId = (req.params as { id?: string })?.id?.toLowerCase() ?? 'unknown';
      return `${ip}:${roomId}`;
    },
  });

  const admissionLimiter = createRateLimitHook({
    ratePerSec: 0.5,
    burst: 30,
  });

  const tokenLimiter = createRateLimitHook({
    ratePerSec: 1,
    burst: 60,
    keyExtractor: (req) => {
      const auth = req.headers['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        return auth.slice(7);
      }
      return defaultIpKeyExtractor(req);
    },
  });

  // POST /api/rooms
  const CreateRoomBodySchema = z.object({
    roomId: z.string().optional(),
    passcode: z.string().min(4).max(64).nullable().optional(),
    name: z.string().min(1).max(50),
    language: z.string().min(1).max(50).optional(),
  });

  app.post('/api/rooms', { preHandler: roomCreateLimiter }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateRoomBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'bad_request',
          message: 'Invalid room creation payload',
          details: parsed.error.format(),
        },
      });
    }

    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined) ?? null;
    const result = await deps.roomService.createRoom({
      roomId: parsed.data.roomId,
      passcode: parsed.data.passcode,
      creatorName: parsed.data.name,
      language: parsed.data.language,
      createKey: idempotencyKey,
    });

    if ('error' in result) {
      return reply.status(409).send({
        error: {
          code: 'room_taken',
          message: `Room ID '${parsed.data.roomId}' is already taken`,
          suggestion: result.suggestion,
        },
      });
    }

    const status = result.isExisting ? 200 : 201;
    return reply.status(status).send(result);
  });

  // GET /api/rooms/:id
  app.get<{ Params: { id: string } }>('/api/rooms/:id', { preHandler: roomGetLimiter }, async (request, reply) => {
    const roomId = request.params.id.toLowerCase();
    const room = deps.roomRepo.findById(roomId);
    if (!room) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `Room '${roomId}' does not exist` },
      });
    }

    const members = deps.memberRepo.getMembers(roomId);
    return reply.send({
      id: room.id,
      hasPasscode: room.passcode_hash !== null,
      locked: room.locked === 1,
      language: room.language,
      memberCount: members.length,
    });
  });

  // POST /api/rooms/:id/join
  const JoinRoomBodySchema = z.object({
    name: z.string().min(1).max(50),
    passcode: z.string().optional(),
    memberId: z.string().optional(),
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/join', { preHandler: joinLimiter }, async (request, reply) => {
    const roomId = request.params.id.toLowerCase();
    const parsed = JoinRoomBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'bad_request', message: 'Invalid join body' },
      });
    }

    const room = deps.roomRepo.findById(roomId);
    if (!room) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `Room '${roomId}' does not exist` },
      });
    }

    // Verify passcode if room has one
    if (room.passcode_hash !== null) {
      if (!parsed.data.passcode) {
        return reply.status(401).send({
          error: { code: 'passcode_required', message: 'Room requires a passcode' },
        });
      }
      const valid = await deps.joinService.verifyPasscode(parsed.data.passcode, room.passcode_hash);
      if (!valid) {
        return reply.status(401).send({
          error: { code: 'invalid_passcode', message: 'Incorrect passcode' },
        });
      }
    }

    const memberId = parsed.data.memberId ?? crypto.randomUUID();

    // Check ban
    if (deps.memberRepo.isBanned(roomId, memberId)) {
      return reply.status(403).send({
        error: { code: 'banned', message: 'You have been kicked from this room' },
      });
    }

    // Check locked
    if (room.locked === 1) {
      const existingMember = deps.memberRepo.getMember(roomId, memberId);
      if (!existingMember) {
        return reply.status(403).send({
          error: { code: 'locked', message: 'Room is currently locked by the host' },
        });
      }
    }

    // Upsert member
    const existingMembers = deps.memberRepo.getMembers(roomId);
    const colorIndex = existingMembers.length % 12;
    deps.memberRepo.upsertMember({
      roomId,
      memberId,
      displayName: parsed.data.name,
      colorIndex,
    });

    const token = await deps.joinService.issueRoomToken({
      memberId,
      roomId,
      displayName: parsed.data.name,
      passcodeVersion: room.passcode_version,
      roomEpoch: room.epoch,
    });

    return reply.status(200).send({
      room: {
        id: room.id,
        epoch: room.epoch,
        language: room.language,
        locked: room.locked === 1,
        hasPasscode: room.passcode_hash !== null,
      },
      token,
      memberId,
    });
  });

  /** Bearer room token check shared by the feed and chat routes. Sends the 401 itself. */
  async function authorizeRoom(request: FastifyRequest, reply: FastifyReply, roomId: string): Promise<boolean> {
    const auth = request.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Bearer token required' } });
      return false;
    }
    try {
      await deps.joinService.verifyRoomToken(auth.slice('Bearer '.length), roomId);
      return true;
    } catch {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Invalid or expired room token' } });
      return false;
    }
  }

  const PageQuerySchema = z.object({
    before: z.coerce.number().int().positive().optional(),
    after: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });

  // GET /api/rooms/:id/chat (ADR-017). Same page shape as /events.
  app.get<{ Params: { id: string } }>('/api/rooms/:id/chat', { preHandler: tokenLimiter }, async (request, reply) => {
    const roomId = request.params.id.toLowerCase();
    if (!(await authorizeRoom(request, reply, roomId))) return reply;

    const query = PageQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: { code: 'invalid', message: 'Invalid pagination query', details: query.error.flatten() },
      });
    }
    const { before, after, limit } = query.data;

    if (after !== undefined) {
      const items = deps.chatService.getAfter(roomId, after, limit);
      return reply.send({
        items,
        nextBefore: null,
        nextAfter: items.length === limit ? items[items.length - 1]!.seq : null,
      });
    }
    const items = deps.chatService.getBefore(roomId, before, limit);
    return reply.send({
      items,
      nextBefore: items.length === limit ? items[items.length - 1]!.seq : null,
      nextAfter: null,
    });
  });

  // GET /api/rooms/:id/events
  app.get<{
    Params: { id: string };
    Querystring: { before?: string; after?: string; limit?: string };
  }>(
    '/api/rooms/:id/events',
    { preHandler: tokenLimiter },
    async (request, reply) => {
      const roomId = request.params.id.toLowerCase();
      if (!(await authorizeRoom(request, reply, roomId))) return reply;

      const limit = Math.min(100, Math.max(1, request.query.limit ? parseInt(request.query.limit, 10) : 50));

      if (request.query.after !== undefined) {
        const afterSeq = parseInt(request.query.after, 10);
        const rows = deps.auditService.getEventsAfter(roomId, afterSeq, limit);
        const items = rows.map(formatAuditEventRow);
        const nextAfter = items.length === limit && items.length > 0 ? items[items.length - 1]!.seq : null;
        return reply.send({
          items,
          nextBefore: null,
          nextAfter,
        });
      }

      const beforeSeq = request.query.before ? parseInt(request.query.before, 10) : undefined;
      const rows = deps.auditService.getEventsBefore(roomId, beforeSeq, limit);
      const items = rows.map(formatAuditEventRow);
      const nextBefore = items.length === limit && items.length > 0 ? items[items.length - 1]!.seq : null;
      return reply.send({
        items,
        nextBefore,
        nextAfter: null,
      });
    }
  );

  // GET /api/rooms/:id/admission
  app.get<{ Params: { id: string } }>('/api/rooms/:id/admission', { preHandler: admissionLimiter }, async (request, reply) => {
    const roomId = request.params.id.toLowerCase();
    const auth = request.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.send({ status: 'reauth' });
    }

    const token = auth.slice('Bearer '.length);
    let claims;
    try {
      claims = await deps.joinService.verifyRoomToken(token, roomId);
    } catch {
      return reply.send({ status: 'reauth' });
    }

    if (getIsDraining() || deps.persistenceService?.isBufferFull()) {
      return reply.send({ status: 'draining' });
    }

    const room = deps.roomRepo.findById(roomId);
    if (!room) {
      return reply.status(404).send({ status: 'not_found' });
    }

    // Check epoch
    if (claims.ep !== room.epoch) {
      return reply.send({ status: 'reauth' });
    }

    // Check passcode version if room has passcode
    if (room.passcode_hash !== null && claims.pv !== room.passcode_version) {
      return reply.send({ status: 'reauth' });
    }

    if (deps.memberRepo.isBanned(roomId, claims.sub)) {
      return reply.send({ status: 'banned' });
    }

    if (room.locked === 1 && !deps.memberRepo.getMember(roomId, claims.sub)) {
      return reply.send({ status: 'locked' });
    }

    const members = deps.memberRepo.getMembers(roomId);
    if (members.length >= MAX_MEMBERS_PER_ROOM && !members.some((m) => m.member_id === claims.sub)) {
      return reply.send({ status: 'full' });
    }

    return reply.send({ status: 'ok' });
  });

  return app;
}
