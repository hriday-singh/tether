import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { ServerConfig } from '../config.js';
import { RoomService } from '../services/roomService.js';
import { JoinService } from '../services/joinService.js';
import { AuditService } from '../services/auditService.js';
import { RoomRegistry } from '../rooms/roomRegistry.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { RoomRepo } from '../repo/roomRepo.js';

export interface AppDependencies {
  config: ServerConfig;
  roomService: RoomService;
  joinService: JoinService;
  auditService: AuditService;
  roomRegistry: RoomRegistry;
  roomRepo: RoomRepo;
  memberRepo: MemberRepo;
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
    return reply.send({ status: 'ready', activeRooms: deps.roomRegistry.activeRoomCount });
  });

  app.get('/metrics', async (_req, reply) => {
    return reply.send({
      activeRooms: deps.roomRegistry.activeRoomCount,
      timestamp: Date.now(),
    });
  });

  // POST /api/rooms
  const CreateRoomBodySchema = z.object({
    roomId: z.string().optional(),
    passcode: z.string().min(4).max(64).nullable().optional(),
    name: z.string().min(1).max(50),
    language: z.string().min(1).max(50).optional(),
  });

  app.post('/api/rooms', async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.get('/api/rooms/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
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

  app.post('/api/rooms/:id/join', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
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

  // GET /api/rooms/:id/events
  app.get(
    '/api/rooms/:id/events',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { before?: string; after?: string; limit?: string };
      }>,
      reply
    ) => {
      const roomId = request.params.id.toLowerCase();
      const auth = request.headers['authorization'];
      if (!auth || !auth.startsWith('Bearer ')) {
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'Bearer token required' },
        });
      }

      const token = auth.slice('Bearer '.length);
      try {
        await deps.joinService.verifyRoomToken(token, roomId);
      } catch {
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'Invalid or expired room token' },
        });
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

      if (request.query.after !== undefined) {
        const afterSeq = parseInt(request.query.after, 10);
        const rows = deps.auditService.getEventsAfter(roomId, afterSeq, limit);
        return reply.send({
          items: rows.map((r) => ({
            ...r,
            payload: JSON.parse(r.payload),
          })),
        });
      }

      const beforeSeq = request.query.before ? parseInt(request.query.before, 10) : undefined;
      const rows = deps.auditService.getEventsBefore(roomId, beforeSeq, limit);
      return reply.send({
        items: rows.map((r) => ({
          ...r,
          payload: JSON.parse(r.payload),
        })),
      });
    }
  );

  // GET /api/rooms/:id/admission
  app.get('/api/rooms/:id/admission', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const roomId = request.params.id.toLowerCase();
    const auth = request.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.status(401).send({ status: 'reauth' });
    }

    const token = auth.slice('Bearer '.length);
    let claims;
    try {
      claims = await deps.joinService.verifyRoomToken(token, roomId);
    } catch {
      return reply.status(401).send({ status: 'reauth' });
    }

    const room = deps.roomRepo.findById(roomId);
    if (!room) {
      return reply.status(404).send({ status: 'not_found' });
    }

    if (deps.memberRepo.isBanned(roomId, claims.sub)) {
      return reply.status(403).send({ status: 'banned' });
    }

    if (room.locked === 1 && !deps.memberRepo.getMember(roomId, claims.sub)) {
      return reply.status(403).send({ status: 'locked' });
    }

    return reply.send({ status: 'ok' });
  });

  return app;
}
