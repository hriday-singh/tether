import { describe, it, expect } from 'vitest';
import {
  DisplayNameSchema,
  ClientControlMessageSchema,
  ServerChatMsgSchema,
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
        chatSeq: 0,
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

describe('Chat schemas (ADR-017)', () => {
  const rid = '11111111-1111-4111-8111-111111111111';

  it('accepts chat.send and trims the text', () => {
    const msg = ClientControlMessageSchema.parse({ t: 'chat.send', rid, text: '  hi  ' });
    expect(msg).toEqual({ t: 'chat.send', rid, text: 'hi' });
  });

  it('rejects empty, whitespace-only and over-long text', () => {
    expect(ClientControlMessageSchema.safeParse({ t: 'chat.send', rid, text: '' }).success).toBe(false);
    expect(ClientControlMessageSchema.safeParse({ t: 'chat.send', rid, text: ' \n\t ' }).success).toBe(false);
    expect(ClientControlMessageSchema.safeParse({ t: 'chat.send', rid, text: 'a'.repeat(2001) }).success).toBe(false);
    expect(ClientControlMessageSchema.safeParse({ t: 'chat.send', rid, text: 'a'.repeat(2000) }).success).toBe(true);
  });

  it('parses chat.msg', () => {
    const message = {
      id: 1,
      roomId: 'room',
      seq: 1,
      clientMsgId: rid,
      memberId: 'm1',
      name: 'Alice',
      colorIndex: 2,
      text: 'hello',
      createdAt: new Date().toISOString(),
    };
    // Older servers omit ref: it defaults to null.
    expect(ServerControlMessageSchema.parse({ t: 'chat.msg', message })).toEqual({ t: 'chat.msg', message: { ...message, ref: null } });
    const ref = { from: 'AQ==', to: 'Ag==', line: 1, endLine: 2, snippet: 'x' };
    expect(ServerChatMsgSchema.parse({ t: 'chat.msg', message: { ...message, ref } }).message.ref).toEqual(ref);
  });

  it('defaults welcome.chatSeq to 0 for older servers', () => {
    const member = { id: 'm1', name: 'A', colorIndex: 0, joinedAt: 'x', status: 'active', isHost: true, isBot: false };
    const welcome = ServerControlMessageSchema.parse({
      t: 'welcome',
      self: member,
      members: [member],
      hostId: 'm1',
      room: { id: 'room', language: 'javascript', locked: false, hasPasscode: false, epoch: rid },
      token: 't',
      eventSeq: 0,
    });
    expect(welcome.t === 'welcome' && welcome.chatSeq).toBe(0);
  });
});

describe('DisplayNameSchema', () => {
  it('strips control, bidi and zero-width characters, then trims', () => {
    expect(DisplayNameSchema.parse('  A\u0000l\u202Eic\u200Be\n ')).toBe('Alice');
  });

  it('enforces 1–32 characters after stripping', () => {
    expect(DisplayNameSchema.safeParse('\u202E\u200B ').success).toBe(false);
    expect(DisplayNameSchema.parse('x'.repeat(32))).toHaveLength(32);
    expect(DisplayNameSchema.safeParse('x'.repeat(33)).success).toBe(false);
  });
});
