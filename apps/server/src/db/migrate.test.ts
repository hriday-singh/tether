import { describe, expect, it } from 'vitest';
import { createDatabase, SqliteSession } from './database.js';
import { applyMigrations, splitStatements } from './migrate.js';

const columns = (db: SqliteSession, table: string) =>
  db.prepare<{ name: string }>(`PRAGMA table_info(${table})`).all().map((c) => c.name);

describe('applyMigrations', () => {
  it('builds an empty database from the files and is a no-op the second time', () => {
    const db = new SqliteSession(':memory:');
    const first = applyMigrations(db);
    expect(first[0]).toBe('0001_init.sqlite.sql');
    expect(columns(db, 'chat_messages')).toContain('code_ref');
    expect(applyMigrations(db)).toEqual([]);
    db.close();
  });

  it('tolerates columns the embedded schema already created', () => {
    const db = createDatabase(':memory:');
    expect(() => applyMigrations(db)).not.toThrow();
    expect(columns(db as SqliteSession, 'chat_messages').filter((c) => c === 'code_ref')).toHaveLength(1);
    db.close();
  });

  it('ignores semicolons inside comments', () => {
    expect(splitStatements('-- a; b\nSELECT 1; -- c;\nSELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });
});
