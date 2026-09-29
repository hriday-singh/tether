import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import * as encoding from 'lib0/encoding';
import { WS_CLOSE_CODES, FRAME_KINDS, MAX_DOC_BYTES, SLOW_CONSUMER_BYTES } from '@tether/shared/constants';
import { decodeFrame } from '@tether/shared/protocol/codec';
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
  public bufferedAmount: number = 0;

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

    it('terminates member sockets with WS_CLOSE_CODES.KICKED when member is kicked', () => {
      roomRepo.create({ id: 'test-kick-room', epoch: 'epoch-1', createdBy: 'u1' });

      const room = new Room(
        'test-kick-room',
        'epoch-1',
        null,
        [],
        persistenceService,
        auditService
      );

      const aliceWs = new MockSocket();
      const bobWs1 = new MockSocket();
      const bobWs2 = new MockSocket();

      room.addConnection(aliceWs as unknown as WebSocket, { id: 'u1', name: 'Alice', colorIndex: 0 });
      room.addConnection(bobWs1 as unknown as WebSocket, { id: 'u2', name: 'Bob', colorIndex: 1 });
      room.addConnection(bobWs2 as unknown as WebSocket, { id: 'u2', name: 'Bob', colorIndex: 1 });

      expect(room.connectionCount).toBe(3);

      room.terminateMemberSockets('u2', WS_CLOSE_CODES.KICKED);

      expect(bobWs1.closedCode).toBe(WS_CLOSE_CODES.KICKED);
      expect(bobWs2.closedCode).toBe(WS_CLOSE_CODES.KICKED);
      expect(aliceWs.closedCode).toBeNull();

      room.destroy();
    });

    it('clears awareness state and broadcasts removal update when connection is removed', () => {
      roomRepo.create({ id: 'test-aw-room', epoch: 'epoch-1', createdBy: 'u1' });

      const room = new Room(
        'test-aw-room',
        'epoch-1',
        null,
        [],
        persistenceService,
        auditService
      );

      const aliceWs = new MockSocket();
      const bobWs = new MockSocket();

      room.addConnection(aliceWs as unknown as WebSocket, { id: 'u1', name: 'Alice', colorIndex: 0 });
      room.addConnection(bobWs as unknown as WebSocket, { id: 'u2', name: 'Bob', colorIndex: 1 });

      // Bob sends awareness claiming clientID 123
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint(encoder, 123);
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarString(
        encoder,
        JSON.stringify({
          memberId: 'u2',
          cursor: null,
          highlight: null,
          typing: false,
          status: 'active',
        })
      );
      const awUpdate = encoding.toUint8Array(encoder);

      room.handleInboundUpdate(bobWs as unknown as WebSocket, 1, new Uint8Array(0), awUpdate);

      // Verify Bob's awareness is present in the room's awareness
      expect(room.awareness.getStates().get(123)).toBeDefined();

      // Clear Alice's sent buffer to isolate removeConnection messages
      aliceWs.sent = [];

      // Disconnect Bob
      room.removeConnection(bobWs as unknown as WebSocket, false);

      // Verify Bob's awareness state is cleared from room's awareness
      expect(room.awareness.getStates().get(123)).toBeUndefined();

      // Verify Alice received an update frame containing the awareness removal
      expect(aliceWs.sent.length).toBeGreaterThanOrEqual(1);
      const binarySent = aliceWs.sent.filter((s) => s instanceof Uint8Array);
      expect(binarySent.length).toBeGreaterThanOrEqual(1);
      const lastBinary = binarySent[binarySent.length - 1] as Uint8Array;
      const decoded = decodeFrame(lastBinary);
      expect(decoded.kind).toBe(FRAME_KINDS.UPDATE);
      if (decoded.kind === FRAME_KINDS.UPDATE) {
        expect(decoded.awarenessUpdate.byteLength).toBeGreaterThan(0);
      }

      room.destroy();
    });

    it('closes slow consumer connection with WS_CLOSE_CODES.SLOW_CONSUMER', () => {
      roomRepo.create({ id: 'test-slow-room', epoch: 'epoch-1', createdBy: 'u1' });

      const room = new Room(
        'test-slow-room',
        'epoch-1',
        null,
        [],
        persistenceService,
        auditService
      );

      const aliceWs = new MockSocket();
      const bobWs = new MockSocket();
      bobWs.bufferedAmount = SLOW_CONSUMER_BYTES + 1024; // Exceeds 4 MB

      room.addConnection(aliceWs as unknown as WebSocket, { id: 'u1', name: 'Alice', colorIndex: 0 });
      room.addConnection(bobWs as unknown as WebSocket, { id: 'u2', name: 'Bob', colorIndex: 1 });

      // Alice sends an update which room attempts to broadcast
      const doc = new Y.Doc();
      doc.getText('codemirror').insert(0, 'hello');
      const update = Y.encodeStateAsUpdate(doc);

      room.handleInboundUpdate(aliceWs as unknown as WebSocket, 1, update, new Uint8Array(0));

      expect(bobWs.closedCode).toBe(WS_CLOSE_CODES.SLOW_CONSUMER);
      expect(aliceWs.closedCode).toBeNull();

      room.destroy();
    });

    it('closes connection with WS_CLOSE_CODES.DOC_TOO_LARGE when doc size exceeds MAX_DOC_BYTES', () => {
      roomRepo.create({ id: 'test-cap-room', epoch: 'epoch-1', createdBy: 'u1' });

      const room = new Room(
        'test-cap-room',
        'epoch-1',
        null,
        [],
        persistenceService,
        auditService
      );

      const aliceWs = new MockSocket();
      room.addConnection(aliceWs as unknown as WebSocket, { id: 'u1', name: 'Alice', colorIndex: 0 });

      // Create an update that pushes doc size > MAX_DOC_BYTES (2 MB)
      const bigDoc = new Y.Doc();
      const bigText = 'a'.repeat(MAX_DOC_BYTES + 1000);
      bigDoc.getText('codemirror').insert(0, bigText);
      const update = Y.encodeStateAsUpdate(bigDoc);

      room.handleInboundUpdate(aliceWs as unknown as WebSocket, 1, update, new Uint8Array(0));

      expect(aliceWs.closedCode).toBe(WS_CLOSE_CODES.DOC_TOO_LARGE);

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
