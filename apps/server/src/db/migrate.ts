import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SqliteSession, type DatabaseSession } from './database.js';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../migrations');

/** SQL statements of a migration file, comments stripped (they may contain ';'). */
export function splitStatements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Applies migrations/*.sqlite.sql in name order, each once, each in its own transaction.
 * Recorded in schema_migrations, so re-running is a no-op. Returns the files applied this run.
 */
export function applyMigrations(db: DatabaseSession, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const done = new Set(db.prepare<{ name: string }>(`SELECT name FROM schema_migrations`).all().map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;
    db.exec('BEGIN');
    try {
      for (const sql of splitStatements(fs.readFileSync(path.join(dir, file), 'utf8'))) {
        try {
          db.exec(sql);
        } catch (err) {
          // Databases created by the embedded schema (database.ts) already have the newer columns.
          if (!/duplicate column name/i.test(String(err))) throw err;
        }
      }
      db.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(file);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`${file} failed, nothing from it was applied: ${err instanceof Error ? err.message : String(err)}`);
    }
    applied.push(file);
  }
  return applied;
}

// CLI: `pnpm db:migrate` (stop the server first).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await import('../config.js'); // loads .env
  if (process.env.DATABASE_DRIVER && process.env.DATABASE_DRIVER !== 'sqlite') {
    console.error('Only DATABASE_DRIVER=sqlite is supported.');
    process.exit(1);
  }
  const file = process.env.SQLITE_PATH ?? './data/tether.db';
  const db = new SqliteSession(file);
  try {
    const applied = applyMigrations(db);
    console.log(applied.length ? `Applied to ${file}:\n  ${applied.join('\n  ')}` : `${file} is up to date.`);
  } finally {
    db.close();
  }
}
