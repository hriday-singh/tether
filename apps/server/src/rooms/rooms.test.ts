import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { AuditRepo } from '../repo/auditRepo.js';
import { PersistenceService } from '../services/persistenceService.js';
import { AuditService } from '../services/auditService.js';
import { Room } from './room.js';
import { RoomRegistry } from './roomRegistry.js';

class MockSocket {
  public readyState: number = WebSocket.OPEN;
  public sent: (Uint8Array | string)[] = [];
  public closedCode: number | null = null;

  public send(data: Uint8Array | string): void {
    this.sent.push(data);
  }

  public close(code?: number): void {
    this.readyState = WebSocket.CLOSED;
    this.closedCode = code ?? 1000;
  }
}

describe('Rooms & RoomRegistry', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let auditRepo: AuditRepo;
  let persistenceService: PersistenceService;
  let auditService: AuditService;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    auditRepo = new AuditRepo(db);
    persistenceService = new PersistenceService(updateRepo, roomRepo, 100);
    auditService = new AuditService(auditRepo);
  });

  afterEach(() => {
    vi.useRealTimers();
    persistenceService.destroy();
    db.close();
  });

  describe('Room', () => {
    it('manages connections and sends quiet checksum after edits', () => {
      roomRepo.create({ id: 'test-r1', epoch: 'epoch-1', createdBy: 'u1' });

      const room = new Room(
        'test-r1',
        'epoch-1',
        null,
        [],
        persistenceService,
        auditService
      );

      const mockWs = new MockSocket();
      room.addConnection(mockWs as unknown as WebSocket, {
        id: 'u1',
        name: 'Alice',
        colorIndex: 0,
      });

      // Apply doc update to room
      const localDoc = new Y.Doc();
      localDoc.getText('codemirror').insert(0, 'console.log(42);');
      const update = Y.encodeStateAsUpdate(localDoc);

      room.handleInboundUpdate(mockWs as unknown as WebSocket, 1, update, new Uint8Array(0));

      // Checksum should NOT be sent yet (quiet window is 500ms)
      expect(mockWs.sent.filter((s) => typeof s === 'string' && s.includes('checksum')).length).toBe(0);

      // Advance by 500ms
      vi.advanceTimersByTime(500);

      // Checksum broadcast sent!
      const checksumMsgs = mockWs.sent.filter((s) => typeof s === 'string' && s.includes('checksum'));
      expect(checksumMsgs.length).toBe(1);

      room.removeConnection(mockWs as unknown as WebSocket, true);
      room.destroy();
    });
  });

  describe('RoomRegistry', () => {
    it('replays snapshot + tail updates on load and unloads idle rooms', () => {
      roomRepo.create({ id: 'r-saved', epoch: 'e1', createdBy: 'u1' });

      // Simulate saved snapshot with text "Initial "
      const snapDoc = new Y.Doc();
      snapDoc.getText('codemirror').insert(0, 'Initial ');
      const snapshot = Y.encodeStateAsUpdate(snapDoc);
      roomRepo.updateSnapshot('r-saved', snapshot, new Date().toISOString());

      // Simulate tail update with text "Tail" applied on top of snapshot
      const tailDoc = new Y.Doc();
      Y.applyUpdate(tailDoc, snapshot);
      tailDoc.getText('codemirror').insert(8, 'Tail');
      const tailUpdate = Y.encodeStateAsUpdate(tailDoc, Y.encodeStateVector(snapDoc));
      updateRepo.insertBatch('r-saved', tailUpdate);

      const registry = new RoomRegistry(
        roomRepo,
        updateRepo,
        persistenceService,
        auditService,
        5000 // 5s idle
      );

      const loadedRoom = registry.getOrCreate('r-saved');
      expect(loadedRoom).toBeDefined();
      expect(loadedRoom?.doc.getText('codemirror').toString()).toBe('Initial Tail');
      expect(registry.activeRoomCount).toBe(1);

      // Simulate 10 seconds of idle with 0 connections
      const now = Date.now() + 10000;
      const unloaded = registry.unloadIdleRooms(now);
      expect(unloaded).toBe(1);
      expect(registry.activeRoomCount).toBe(0);

      registry.destroy();
    });
  });
});
