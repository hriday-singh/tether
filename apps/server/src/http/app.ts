import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { DisplayNameSchema } from '@tether/shared/protocol/schemas';
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

import { PersistenceService } from '../services/persistenceService.js';
import { createRateLimitHook, defaultIpKeyExtractor } from './rateLimiter.js';
import { openApiSpec } from './openapi.js';

import { BotStormManager } from '../rooms/botStormManager.js';

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
  botStormManager?: BotStormManager;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = fastify({
    logger: false,
    // Trust the first TRUST_PROXY_HOPS hops (our proxies); 0 = request.ip is the socket peer.
    trustProxy: (_address, hop) => hop < deps.config.TRUST_PROXY_HOPS,
  });

  // Enable CORS
  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || deps.config.ALLOWED_ORIGINS.includes(origin)) {
        return cb(null, true);
      }
      if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  // Centralized standard error handler
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      // Server faults: log the detail, never send it (DB/stack messages leak internals).
      console.error('[http] Unhandled error:', error);
      return reply.status(statusCode).send({
        error: { code: 'internal_server_error', message: 'An unexpected error occurred' },
      });
    }
    return reply.status(statusCode).send({
      error: {
        code: error.code ?? 'bad_request',
        message: error.message || 'Invalid request',
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
  // Runs before tokenLimiter: the token key is unverified at that point, so fresh junk tokens would
  // otherwise each get a full bucket (no limit) and a map entry.
  const tokenIpLimiter = createRateLimitHook({ ratePerSec: 2, burst: 120 });
  const tokenLimiters = [tokenIpLimiter, tokenLimiter];

  // POST /api/rooms
  const CreateRoomBodySchema = z.object({
    roomId: z
      .string()
      .trim()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/i, 'Invalid roomId format. Must be 3-32 lowercase alphanumeric characters or hyphens.')
      .optional(),
    passcode: z.string().min(4).max(64).nullable().optional(),
    name: DisplayNameSchema,
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
    // Input is fully validated above; anything thrown here is a server fault (500 via the error handler).
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

    return reply.send({
      id: room.id,
      hasPasscode: room.passcode_hash !== null,
      locked: room.locked === 1,
      language: room.language,
      // Online humans only; an unloaded room has nobody connected.
      memberCount: deps.roomRegistry.get(roomId)?.humanCount ?? 0,
    });
  });

  // POST /api/rooms/:id/join
  const JoinRoomBodySchema = z.object({
    name: DisplayNameSchema,
    passcode: z.string().max(64).optional(),
    memberId: z.string().max(64).optional(),
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
          error: { code: 'passcode_required', message: 'Room requires a password' },
        });
      }
      const valid = await deps.joinService.verifyPasscode(parsed.data.passcode, room.passcode_hash);
      if (!valid) {
        return reply.status(401).send({
          error: { code: 'invalid_passcode', message: 'Incorrect password' },
        });
      }
    }

    let memberId: string = crypto.randomUUID();
    if (parsed.data.memberId) {
      // Reclaiming an identity takes that identity's token. Member IDs are visible to everyone in the
      // room, so trusting a bare ID would let any member rejoin as the host.
      const auth = request.headers['authorization'];
      const claims = auth?.startsWith('Bearer ')
        ? await deps.joinService.verifyRoomToken(auth.slice('Bearer '.length), roomId).catch(() => null)
        : null;
      if (claims?.sub !== parsed.data.memberId) {
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'A valid token for this member is required to rejoin as them' },
        });
      }
      memberId = parsed.data.memberId;
    }

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
    const existingMember = deps.memberRepo.getMember(roomId, memberId);
    // Cap people online now, not room history (room_members keeps everyone who ever joined).
    if (deps.roomRegistry.get(roomId)?.hasSeatFor(memberId) === false) {
      return reply.status(403).send({
        error: { code: 'full', message: 'Room is full' },
      });
    }
    const colorIndex = existingMember?.color_index ?? (existingMembers.length % 12);
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
  app.get<{ Params: { id: string } }>('/api/rooms/:id/chat', { preHandler: tokenLimiters }, async (request, reply) => {
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
  app.get<{ Params: { id: string } }>('/api/rooms/:id/events', { preHandler: tokenLimiters }, async (request, reply) => {
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
      const rows = deps.auditService.getEventsAfter(roomId, after, limit);
      const items = rows.map(formatAuditEventRow);
      const nextAfter = items.length === limit && items.length > 0 ? items[items.length - 1]!.seq : null;
      return reply.send({
        items,
        nextBefore: null,
        nextAfter,
      });
    }

    const rows = deps.auditService.getEventsBefore(roomId, before, limit);
    const items = rows.map(formatAuditEventRow);
    const nextBefore = items.length === limit && items.length > 0 ? items[items.length - 1]!.seq : null;
    return reply.send({
      items,
      nextBefore,
      nextAfter: null,
    });
  });

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

    if (deps.roomRegistry.get(roomId)?.hasSeatFor(claims.sub) === false) {
      return reply.send({ status: 'full' });
    }

    return reply.send({ status: 'ok' });
  });

  return app;
}
