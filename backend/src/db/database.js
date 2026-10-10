import Database from 'better-sqlite3';
import { mkdirSync, openSync, closeSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrateDatabase } from './migrations.js';

export class DatabaseInitializationError extends Error {
  constructor() {
    super('Unable to initialize the database. Check local configuration and file permissions.');
    this.name = 'DatabaseInitializationError';
    this.code = 'DATABASE_INIT_FAILED';
  }
}

export function openDatabase({ databasePath, databaseBusyTimeoutMs }) {
  let db;
  try {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
      // Restrictive permissions for newly created files; never truncate an existing database.
      try {
        const fd = openSync(databasePath, 'wx', 0o600);
        closeSync(fd);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stat = lstatSync(databasePath);
        if (!stat.isFile()) throw new Error('Database path must be a regular file');
        if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
          throw new Error('Existing database permissions must exclude group and other users');
        }
      }
    }
    db = new Database(databasePath, { timeout: databaseBusyTimeoutMs });
    db.pragma('foreign_keys = ON');
    // Reject incompatible schemas before altering persistent pragmas.
    migrateDatabase(db);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    return db;
  } catch {
    if (db?.open) db.close();
    // Native/SQL/file errors may contain local paths and are deliberately not exposed.
    throw new DatabaseInitializationError();
  }
}
