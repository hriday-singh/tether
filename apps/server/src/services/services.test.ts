import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { AuditRepo } from '../repo/auditRepo.js';
import { JoinService } from './joinService.js';
import { RoomService } from './roomService.js';
import { AuditService } from './auditService.js';
import { PersistenceService } from './persistenceService.js';

describe('Services Layer', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let memberRepo: MemberRepo;
  let auditRepo: AuditRepo;

  let joinService: JoinService;
  let roomService: RoomService;
  let auditService: AuditService;
  let persistenceService: PersistenceService;

  const JWT_SECRET = 'very_secure_secret_key_that_is_at_least_32_characters_long!';

  beforeEach(() => {
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    memberRepo = new MemberRepo(db);
    auditRepo = new AuditRepo(db);

    joinService = new JoinService(JWT_SECRET);
    auditService = new AuditService(auditRepo);
    roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
    persistenceService = new PersistenceService(updateRepo, roomRepo, 50);
  });

  afterEach(() => {
    persistenceService.destroy();
    db.close();
  });

  describe('JoinService', () => {
    it('hashes and securely verifies passcodes', async () => {
      const hash = await joinService.hashPasscode('my-secret-passcode');
      expect(hash.startsWith('scrypt$')).toBe(true);

      const isValid = await joinService.verifyPasscode('my-secret-passcode', hash);
      expect(isValid).toBe(true);

      const isInvalid = await joinService.verifyPasscode('wrong-passcode', hash);
      expect(isInvalid).toBe(false);
    });

    it('issues and verifies signed JWT room session tokens', async () => {
      const token = await joinService.issueRoomToken({
        memberId: 'mem-123',
        roomId: 'room-abc',
        displayName: 'Alice',
        passcodeVersion: 1,
        roomEpoch: 'epoch-1',
      });

      const claims = await joinService.verifyRoomToken(token, 'room-abc');
      expect(claims.sub).toBe('mem-123');
      expect(claims.aud).toBe('room:room-abc');
      expect(claims.name).toBe('Alice');
      expect(claims.pv).toBe(1);
      expect(claims.ep).toBe('epoch-1');

      // Fails for wrong room audience
      await expect(joinService.verifyRoomToken(token, 'other-room')).rejects.toThrow();
    });
  });

  describe('RoomService', () => {
    it('creates room with generated slug or custom slug', async () => {
      const result = await roomService.createRoom({
        creatorName: 'Alice',
        passcode: 'secret',
      });

      expect('room' in result).toBe(true);
      if ('room' in result) {
        expect(result.room.hasPasscode).toBe(true);
        expect(result.room.id).toBeDefined();
        expect(result.token).toBeDefined();
      }
    });

    it('handles Idempotency-Key retry transparently', async () => {
      const key = 'idempotent-key-1';
      const first = await roomService.createRoom({
        creatorName: 'Alice',
        roomId: 'unique-room',
        createKey: key,
      });

      const second = await roomService.createRoom({
        creatorName: 'Alice',
        roomId: 'unique-room',
        createKey: key,
      });

      expect('room' in first && 'room' in second).toBe(true);
      if ('room' in first && 'room' in second) {
        expect(second.room.id).toBe(first.room.id);
        expect(second.memberId).toBe(first.memberId);
        expect(second.isExisting).toBe(true);
      }
    });

    it('suggests alternate slug if custom slug is taken with different key', async () => {
      await roomService.createRoom({
        creatorName: 'Alice',
        roomId: 'my-custom-room',
      });

      const second = await roomService.createRoom({
        creatorName: 'Bob',
        roomId: 'my-custom-room',
      });

      expect('error' in second).toBe(true);
      if ('error' in second) {
        expect(second.error).toBe('room_taken');
        expect(second.suggestion.startsWith('my-custom-room-')).toBe(true);
      }
    });
  });

  describe('AuditService', () => {
    it('increments sequence numbers gaplessly per room', () => {
      roomRepo.create({ id: 'r1', epoch: 'e1', createdBy: 'u1' });
      roomRepo.create({ id: 'r2', epoch: 'e2', createdBy: 'u2' });

      const seq1 = auditService.logEvent('r1', { type: 'edit.one' });
      const seq2 = auditService.logEvent('r1', { type: 'edit.two' });
      const seq3 = auditService.logEvent('r2', { type: 'other.room' });

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(1); // separate sequence for room r2
    });
  });

  describe('PersistenceService', () => {
    it('debounces flush and dispatches acks only after DB commit', async () => {
      roomRepo.create({ id: 'r1', epoch: 'e1', createdBy: 'u1' });

      const acksReceived: number[] = [];
      const ackRecipient = {
        seq: 42,
        sendAck: (s: number) => acksReceived.push(s),
      };

      const doc = new Y.Doc();
      doc.getText('t').insert(0, 'Hello');
      const update = Y.encodeStateAsUpdate(doc);

      persistenceService.enqueueUpdate('r1', update, ackRecipient);
      expect(acksReceived.length).toBe(0); // Not committed yet

      // Immediate flush manually
      const id = persistenceService.flush('r1');
      expect(id).toBe(1);
      expect(acksReceived).toEqual([42]); // Acked after DB write!
    });
  });
});
