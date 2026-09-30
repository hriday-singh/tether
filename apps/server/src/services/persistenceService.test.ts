import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { PersistenceService, BufferFullError } from './persistenceService.js';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { PERSIST_MAX_QUEUED_PER_ROOM, PERSIST_MAX_BUFFERED_UPDATES } from '@tether/shared/constants';

describe('PersistenceService Bounded Buffer & Eager Flush', () => {
  let db: DatabaseSession;
  let roomRepo: RoomRepo;
  let updateRepo: UpdateRepo;
  let service: PersistenceService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    roomRepo = new RoomRepo(db);
    updateRepo = new UpdateRepo(db);
    roomRepo.create({
      id: 'room-1',
      epoch: '1',
      createdBy: 'Alice',
    });
    service = new PersistenceService(updateRepo, roomRepo, 1000);
  });

  afterEach(() => {
    service.destroy();
    db.close();
  });

  it('tracks totalBufferedUpdates and decrements on successful flush', () => {
    expect(service.getTotalBufferedUpdates()).toBe(0);
    expect(service.isBufferFull()).toBe(false);

    const doc = new Y.Doc();
    doc.getText('codemirror').insert(0, 'Hello');
    const update1 = Y.encodeStateAsUpdate(doc);

    service.enqueueUpdate('room-1', update1);
    expect(service.getTotalBufferedUpdates()).toBe(1);

    service.flush('room-1');
    expect(service.getTotalBufferedUpdates()).toBe(0);
  });

  it('triggers immediate flush when room queue reaches PERSIST_MAX_QUEUED_PER_ROOM', () => {
    const flushSpy = vi.spyOn(service, 'flush');
    const doc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(doc);

    for (let i = 0; i < PERSIST_MAX_QUEUED_PER_ROOM - 1; i++) {
      service.enqueueUpdate('room-1', update);
    }
    expect(flushSpy).not.toHaveBeenCalled();
    expect(service.getTotalBufferedUpdates()).toBe(PERSIST_MAX_QUEUED_PER_ROOM - 1);

    // 64th update triggers immediate flush
    service.enqueueUpdate('room-1', update);
    expect(flushSpy).toHaveBeenCalledWith('room-1', undefined);
    expect(service.getTotalBufferedUpdates()).toBe(0);
  });

  it('throws BufferFullError and rejects updates when totalBufferedUpdates >= PERSIST_MAX_BUFFERED_UPDATES', () => {
    const doc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(doc);

    (service as unknown as { totalBufferedUpdates: number }).totalBufferedUpdates = PERSIST_MAX_BUFFERED_UPDATES;
    expect(service.isBufferFull()).toBe(true);

    expect(() => {
      service.enqueueUpdate('room-1', update);
    }).toThrow(BufferFullError);
  });
});
