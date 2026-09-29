import { describe, it, expect } from 'vitest';
import {
  ClientControlMessageSchema,
  ServerControlMessageSchema,
  AwarenessStateSchema,
  StandardErrorResponseSchema,
} from './schemas.js';

describe('Protocol Schemas', () => {
  describe('Client Control Messages', () => {
    it('validates client ping', () => {
      const msg = { t: 'ping', id: 1, ts: 1700000000000 };
      expect(ClientControlMessageSchema.parse(msg)).toEqual(msg);
    });

    it('validates client leave', () => {
      const msg = { t: 'leave' };
      expect(ClientControlMessageSchema.parse(msg)).toEqual(msg);
    });

    it('validates client host.kick with valid uuid rid', () => {
      const msg = {
        t: 'host.kick',
        rid: '123e4567-e89b-12d3-a456-426614174000',
        memberId: 'user-42',
      };
      expect(ClientControlMessageSchema.parse(msg)).toEqual(msg);
    });

    it('rejects client host.kick with invalid rid', () => {
      const msg = {
        t: 'host.kick',
        rid: 'not-a-uuid',
        memberId: 'user-42',
      };
      expect(() => ClientControlMessageSchema.parse(msg)).toThrow();
    });

    it('validates host.lock and host.passcode', () => {
      const lockMsg = {
        t: 'host.lock',
        rid: '123e4567-e89b-12d3-a456-426614174000',
        locked: true,
      };
      expect(ClientControlMessageSchema.parse(lockMsg)).toEqual(lockMsg);

      const passMsg = {
        t: 'host.passcode',
        rid: '123e4567-e89b-12d3-a456-426614174000',
        passcode: 'secret123',
      };
      expect(ClientControlMessageSchema.parse(passMsg)).toEqual(passMsg);

      const clearPassMsg = {
        t: 'host.passcode',
        rid: '123e4567-e89b-12d3-a456-426614174000',
        passcode: null,
      };
      expect(ClientControlMessageSchema.parse(clearPassMsg)).toEqual(clearPassMsg);
    });

    it('validates demo.storm within limits and rejects out-of-bound', () => {
      const validStorm = {
        t: 'demo.storm',
        rid: '123e4567-e89b-12d3-a456-426614174000',
        bots: 5,
        seconds: 30,
        faults: true,
      };
      expect(ClientControlMessageSchema.parse(validStorm)).toEqual(validStorm);

      const invalidBots = {
        ...validStorm,
        bots: 20, // max is 8
      };
      expect(() => ClientControlMessageSchema.parse(invalidBots)).toThrow();
    });

    it('rejects unknown discriminator', () => {
      const invalid = { t: 'unknown.message' };
      expect(() => ClientControlMessageSchema.parse(invalid)).toThrow();
    });
  });

  describe('Server Control Messages', () => {
    it('validates server welcome message', () => {
      const welcome = {
        t: 'welcome',
        self: {
          id: 'mem-1',
          name: 'Alice',
          colorIndex: 0,
          joinedAt: new Date().toISOString(),
          status: 'active' as const,
          isHost: true,
          isBot: false,
        },
        members: [],
        hostId: 'mem-1',
        room: {
          id: 'demo-room',
          language: 'javascript',
          locked: false,
          hasPasscode: false,
          epoch: '123e4567-e89b-12d3-a456-426614174000',
        },
        token: 'signed.jwt.token',
        eventSeq: 0,
      };
      expect(ServerControlMessageSchema.parse(welcome)).toEqual(welcome);
    });

    it('validates server ack message', () => {
      const ack = { t: 'ack', seq: 42 };
      expect(ServerControlMessageSchema.parse(ack)).toEqual(ack);
    });

    it('validates server error and ok messages with rid', () => {
      const ok = { t: 'ok', rid: '123e4567-e89b-12d3-a456-426614174000' };
      expect(ServerControlMessageSchema.parse(ok)).toEqual(ok);

      const err = {
        t: 'error',
        code: 'forbidden',
        message: 'Host privileges required',
        rid: '123e4567-e89b-12d3-a456-426614174000',
      };
      expect(ServerControlMessageSchema.parse(err)).toEqual(err);
    });

    it('validates server checksum message', () => {
      const checksum = { t: 'checksum', sv: 'state-vec-b64', hash: 'abc12345' };
      expect(ServerControlMessageSchema.parse(checksum)).toEqual(checksum);
    });
  });

  describe('Awareness State Validation', () => {
    it('validates proper awareness state', () => {
      const state = {
        memberId: 'mem-1',
        cursor: {
          anchor: { type: null, assoc: 0 },
          head: { type: null, assoc: 0 },
        },
        highlight: null,
        typing: true,
        status: 'active' as const,
      };
      expect(AwarenessStateSchema.parse(state)).toEqual(state);
    });

    it('rejects oversized awareness payload', () => {
      const hugeString = 'a'.repeat(3000);
      const state = {
        memberId: 'mem-1',
        cursor: null,
        highlight: null,
        typing: false,
        status: 'active' as const,
        extraData: hugeString,
      };
      expect(() => AwarenessStateSchema.parse(state)).toThrow();
    });
  });

  describe('Standard Error Response Schema', () => {
    it('validates standard API error format', () => {
      const err = {
        error: {
          code: 'not_found',
          message: 'Room not found',
        },
      };
      expect(StandardErrorResponseSchema.parse(err)).toEqual(err);
    });
  });
});
