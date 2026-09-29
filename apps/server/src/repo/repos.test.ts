import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from './roomRepo.js';
import { UpdateRepo } from './updateRepo.js';
import { MemberRepo } from './memberRepo.js';
import { AuditRepo } from './auditRepo.js';

describe('Repository Layer', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let memberRepo: MemberRepo;
  let auditRepo: AuditRepo;

  beforeEach(() => {
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    memberRepo = new MemberRepo(db);
    auditRepo = new AuditRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('RoomRepo', () => {
    it('creates, finds and updates room settings and snapshot', () => {
      roomRepo.create({
        id: 'test-room',
        epoch: 'epoch-123',
        createdBy: 'creator-1',
        createKey: 'key-abc',
      });

      const found = roomRepo.findById('test-room');
      expect(found).toBeDefined();
      expect(found?.id).toBe('test-room');
      expect(found?.epoch).toBe('epoch-123');
      expect(found?.locked).toBe(0);

      const byKey = roomRepo.findByCreateKey('key-abc');
      expect(byKey?.id).toBe('test-room');

      // Update settings
      roomRepo.updateSettings('test-room', {
        locked: true,
        language: 'typescript',
        passcodeHash: 'hash-xyz',
        passcodeVersion: 1,
      });

      const updated = roomRepo.findById('test-room');
      expect(updated?.locked).toBe(1);
      expect(updated?.language).toBe('typescript');
      expect(updated?.passcode_hash).toBe('hash-xyz');
      expect(updated?.passcode_version).toBe(1);

      // Snapshot update
      const snap = new Uint8Array([1, 2, 3, 4]);
      const nowIso = new Date().toISOString();
      roomRepo.updateSnapshot('test-room', snap, nowIso);

      const withSnap = roomRepo.findById('test-room');
      expect(withSnap?.snapshot).toBeDefined();
      expect(Array.from(withSnap!.snapshot!)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('UpdateRepo', () => {
    it('appends updates, retrieves tail, and compacts before id', () => {
      roomRepo.create({ id: 'r1', epoch: 'e1', createdBy: 'u1' });

      const id1 = updateRepo.insertBatch('r1', new Uint8Array([1]));
      const id2 = updateRepo.insertBatch('r1', new Uint8Array([2]));
      const id3 = updateRepo.insertBatch('r1', new Uint8Array([3]));

      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);

      const tail = updateRepo.getTailAfter('r1', id1);
      expect(tail.length).toBe(2);
      expect(tail[0]?.id).toBe(id2);
      expect(tail[1]?.id).toBe(id3);

      expect(updateRepo.countUpdates('r1')).toBe(3);

      // Compact up to id2
      const deleted = updateRepo.compactBefore('r1', id2);
      expect(deleted).toBe(2);
      expect(updateRepo.countUpdates('r1')).toBe(1);
    });
  });

  describe('MemberRepo', () => {
    it('manages member upserts and ban tracking', () => {
      roomRepo.create({ id: 'r1', epoch: 'e1', createdBy: 'u1' });

      memberRepo.upsertMember({
        roomId: 'r1',
        memberId: 'm1',
        displayName: 'Alice',
        colorIndex: 2,
      });

      expect(memberRepo.isBanned('r1', 'm1')).toBe(false);

      const mem = memberRepo.getMember('r1', 'm1');
      expect(mem?.display_name).toBe('Alice');

      // Ban member
      memberRepo.banMember('r1', 'm1');
      expect(memberRepo.isBanned('r1', 'm1')).toBe(true);

      // Ban non-existent member
      memberRepo.banMember('r1', 'm2');
      expect(memberRepo.isBanned('r1', 'm2')).toBe(true);
    });
  });

  describe('AuditRepo', () => {
    it('inserts events and queries with gapless seq and pagination', () => {
      roomRepo.create({ id: 'r1', epoch: 'e1', createdBy: 'u1' });

      expect(auditRepo.getLatestSeq('r1')).toBe(0);

      auditRepo.insertBatch([
        { roomId: 'r1', seq: 1, type: 'room.created', payload: { foo: 'bar' } },
        { roomId: 'r1', seq: 2, type: 'member.joined' },
        { roomId: 'r1', seq: 3, type: 'host.changed' },
      ]);

      expect(auditRepo.getLatestSeq('r1')).toBe(3);

      // Query before seq 3 (should return seq 2, 1 in descending order)
      const before = auditRepo.getEventsBefore('r1', 3, 10);
      expect(before.length).toBe(2);
      expect(before[0]?.seq).toBe(2);
      expect(before[1]?.seq).toBe(1);

      // Query after seq 1 (should return seq 2, 3 in ascending order)
      const after = auditRepo.getEventsAfter('r1', 1, 10);
      expect(after.length).toBe(2);
      expect(after[0]?.seq).toBe(2);
      expect(after[1]?.seq).toBe(3);
    });
  });
});
