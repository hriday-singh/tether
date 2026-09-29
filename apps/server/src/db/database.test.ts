import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, DatabaseSession } from './database.js';

describe('DatabaseSession', () => {
  let db: DatabaseSession;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('initializes schema and executes queries with prepared statements', () => {
    const insertStmt = db.prepare(
      `INSERT INTO rooms (id, epoch, created_by) VALUES (?, ?, ?)`
    );
    const result = insertStmt.run('demo-room', 'epoch-1', 'user-1');
    expect(result.changes).toBe(1);

    const selectStmt = db.prepare<{ id: string; epoch: string }>(
      `SELECT id, epoch FROM rooms WHERE id = ?`
    );
    const row = selectStmt.get('demo-room');
    expect(row).toBeDefined();
    expect(row?.id).toBe('demo-room');
    expect(row?.epoch).toBe('epoch-1');
  });

  it('enforces foreign key constraints', () => {
    const insertUpdate = db.prepare(
      `INSERT INTO room_updates (room_id, update_data) VALUES (?, ?)`
    );
    // room 'non-existent' does not exist -> FK error
    expect(() => insertUpdate.run('non-existent', new Uint8Array([1, 2, 3]))).toThrow();
  });
});
