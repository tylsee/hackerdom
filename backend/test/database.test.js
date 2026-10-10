import Database from 'better-sqlite3';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, DatabaseInitializationError } from '../src/db/database.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createJobService } from '../src/services/job-service.js';
import { migrations, migrateDatabase } from '../src/db/migrations.js';

const databases = [];
const dirs = [];
const config = (databasePath) => ({ databasePath, databaseBusyTimeoutMs: 100 });
const open = (path = ':memory:') => { const db = openDatabase(config(path)); databases.push(db); return db; };
const temporaryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'docuai-db-test-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
};
const jobInput = { preferences: { writingTone: 'professional', documentType: 'tutorial' }, metadata: { title: 'Saved job' } };
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) {
    // Only known, unique test-owned directories; no recursive personal-file cleanup.
    for (const name of readdirSync(dir)) unlinkSync(join(dir, name));
    rmdirSync(dir);
  }
});

describe('SQLite initialization and migrations', () => {
  it('creates the versioned schema with foreign keys and explicit separate tables', () => {
    const db = open();
    expect(db.pragma('user_version', { simple: true })).toBe(5);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare('SELECT version, name FROM schema_migrations').all())
      .toEqual([{ version: 1, name: 'jobs_preferences_metadata' },
        { version: 2, name: 'input_type_and_processing_statuses' },
        { version: 3, name: 'screenshots_with_ordered_evidence' },
        { version: 4, name: 'videos_and_timestamped_frames' },
        { version: 5, name: 'gemini_analysis_and_evidence_grounded_steps' }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name))
      .toEqual(['analyses', 'analysis_steps', 'job_metadata', 'job_preferences', 'job_videos', 'jobs', 'schema_migrations', 'screenshots', 'video_frames']);
  });

  it('rolls back migration DDL and history if a migration fails after creating a table', () => {
    const db = new Database(':memory:');
    databases.push(db);
    const originalSql = migrations[0].sql;
    try {
      migrations[0].sql = 'CREATE TABLE partial (id INTEGER); INVALID SQL;';
      expect(() => migrateDatabase(db)).toThrow();
      expect(db.pragma('user_version', { simple: true })).toBe(0);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()).toEqual([]);
    } finally {
      migrations[0].sql = originalSql;
    }
  });

  it('persists preferences, metadata and authorization across database close/reopen without rerunning migrations', () => {
    const path = temporaryPath();
    let db = open(path);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const created = createJobService(createJobRepository(db)).create(jobInput);
    const appliedAt = db.prepare('SELECT applied_at FROM schema_migrations').get().applied_at;
    db.close();
    db = open(path);
    expect(createJobService(createJobRepository(db)).get(created.job.id, created.accessToken)).toEqual(created.job);
    expect(db.prepare('SELECT applied_at FROM schema_migrations').get().applied_at).toBe(appliedAt);
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(5);
  });

  it('rolls back job creation if preference insertion fails', () => {
    const db = open();
    const repository = createJobRepository(db);
    expect(() => repository.create({ id: 'test-job', accessTokenHash: 'a'.repeat(64), timestamp: 'now',
      preferences: { writingTone: 'invalid', documentType: 'sop', inputType: 'screenshots' }, metadata: {} })).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM jobs').get().count).toBe(0);
    expect(db.prepare('SELECT count(*) AS count FROM job_metadata').get().count).toBe(0);
  });

  it('rolls back earlier inserts if metadata insertion fails', () => {
    const db = open();
    expect(() => createJobRepository(db).create({ id: 'test-job', accessTokenHash: 'a'.repeat(64), timestamp: 'now',
      preferences: { writingTone: 'academic', documentType: 'sop', inputType: 'screenshots' }, metadata: { objectives: 'invalid-array' } })).toThrow();
    for (const table of ['jobs', 'job_preferences', 'job_metadata']) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count).toBe(0);
    }
  });

  it('enforces foreign keys and cascades job-associated metadata at the schema level', () => {
    const db = open();
    expect(() => db.prepare('INSERT INTO job_preferences VALUES (?, ?, ?, ?)').run('missing', 'academic', 'sop', 'screenshots')).toThrow();
    const { job } = createJobService(createJobRepository(db)).create(jobInput);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
    expect(db.prepare('SELECT count(*) AS count FROM job_preferences').get().count).toBe(0);
    expect(db.prepare('SELECT count(*) AS count FROM job_metadata').get().count).toBe(0);
  });

  it('returns a safe 503 if another connection holds the SQLite write lock', async () => {
    const path = temporaryPath();
    const db = open(path);
    const locker = new Database(path);
    databases.push(locker);
    const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }),
      jobService: createJobService(createJobRepository(db)), logger: createLogger({ level: 'silent' }) });
    locker.exec('BEGIN IMMEDIATE');
    try {
      const response = await request(app).post('/api/jobs').send(jobInput).expect(503);
      expect(response.body.error.code).toBe('DATABASE_BUSY');
      expect(JSON.stringify(response.body)).not.toContain(path);
      expect(db.prepare('SELECT count(*) AS count FROM jobs').get().count).toBe(0);
    } finally {
      locker.exec('ROLLBACK');
    }
  });

  it('refuses a schema newer than the application without overwriting it', () => {
    const path = temporaryPath();
    const db = open(path);
    db.pragma('user_version = 99');
    db.close();
    expect(() => openDatabase(config(path))).toThrow(DatabaseInitializationError);
    const inspection = new Database(path, { readonly: true });
    expect(inspection.pragma('user_version', { simple: true })).toBe(99);
    inspection.close();
  });

  it('refuses an unrelated database rather than adding application tables', () => {
    const path = temporaryPath();
    const unrelated = new Database(path);
    unrelated.exec('CREATE TABLE unrelated (id INTEGER); INSERT INTO unrelated VALUES (7);');
    unrelated.close();
    chmodSync(path, 0o600);
    expect(() => openDatabase(config(path))).toThrow(DatabaseInitializationError);
    const inspection = new Database(path, { readonly: true });
    expect(inspection.prepare('SELECT id FROM unrelated').get().id).toBe(7);
    expect(inspection.prepare("SELECT name FROM sqlite_master WHERE name = 'jobs'").get()).toBeUndefined();
    inspection.close();
  });

  it('refuses a corrupted migration history', () => {
    const path = temporaryPath();
    const db = open(path);
    db.prepare('UPDATE schema_migrations SET name = ?').run('wrong-history');
    db.close();
    expect(() => openDatabase(config(path))).toThrow(DatabaseInitializationError);
  });

  it('rejects an existing database with group/other read permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    const path = temporaryPath();
    open(path).close();
    chmodSync(path, 0o644);
    expect(() => openDatabase(config(path))).toThrow(DatabaseInitializationError);
    expect(statSync(path).mode & 0o777).toBe(0o644); // No silent permission rewrite.
  });

  it('rejects views in an unrelated otherwise table-free database', () => {
    const path = temporaryPath();
    const unrelated = new Database(path);
    unrelated.exec('CREATE VIEW unrelated_view AS SELECT 1 AS id');
    unrelated.close();
    chmodSync(path, 0o600);
    expect(() => openDatabase(config(path))).toThrow(DatabaseInitializationError);
    const inspection = new Database(path, { readonly: true });
    expect(inspection.prepare('SELECT id FROM unrelated_view').get().id).toBe(1);
    expect(inspection.pragma('journal_mode', { simple: true })).toBe('delete');
    inspection.close();
  });

  it('rejects an altered schema even when migration history matches', () => {
    const path = temporaryPath();
    const db = open(path);
    db.exec('ALTER TABLE jobs ADD COLUMN unexpected TEXT');
    db.close();
    expect(() => openDatabase(config(path))).toThrow(DatabaseInitializationError);
  });

  it('reports a directory path as a safe initialization failure without local path details', () => {
    const path = temporaryPath();
    const dir = join(path, '..');
    try {
      openDatabase(config(dir));
      expect.unreachable('Opening a directory should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseInitializationError);
      expect(error.code).toBe('DATABASE_INIT_FAILED');
      expect(error.message).not.toContain(dir);
    }
  });
});


describe('version 2 to version 3 screenshot migration', () => {
  it('retains existing v2 jobs and bearer hashes while adding the screenshot schema', () => {
    const path = temporaryPath();
    const previous = new Database(path);
    databases.push(previous);
    previous.pragma('foreign_keys = OFF');
    previous.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;`);
    previous.exec(migrations[0].sql);
    previous.exec(migrations[1].sql);
    previous.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(1, migrations[0].name, 'old1');
    previous.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(2, migrations[1].name, 'old2');
    previous.pragma('user_version = 2');
    const id = '1f0b3eed-c581-46e2-a4f7-89aa9ea1b7d9';
    previous.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)').run(id, 'd'.repeat(64), 'uploaded', 'old', 'old');
    previous.prepare('INSERT INTO job_preferences VALUES (?, ?, ?, ?)').run(id, 'academic', 'lab_report', 'screenshots');
    previous.prepare('INSERT INTO job_metadata(job_id, title) VALUES (?, ?)').run(id, 'Existing notes');
    previous.close();
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    const updated = open(path);
    expect(updated.pragma('user_version', { simple: true })).toBe(5);
    expect(updated.prepare('SELECT access_token_hash, status FROM jobs WHERE id = ?').get(id))
      .toEqual({ access_token_hash: 'd'.repeat(64), status: 'uploaded' });
    expect(updated.prepare('SELECT title FROM job_metadata WHERE job_id = ?').get(id).title).toBe('Existing notes');
    expect(updated.prepare('SELECT COUNT(*) AS total FROM screenshots').get().total).toBe(0);
    expect(updated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    updated.close();
    open(path);
  });
});

describe('version 1 to version 2 upgrade and status constraints', () => {
  it('upgrades an existing v1 database in place without losing tokens or child rows', () => {
    const path = temporaryPath();
    const original = new Database(path);
    databases.push(original);
    original.pragma('foreign_keys = ON');
    original.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;`);
    original.exec(migrations[0].sql);
    original.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(migrations[0].name, 'old-migration-time');
    original.pragma('user_version = 1');
    const tokenHash = 'f'.repeat(64);
    const id = '9841ea78-5a72-4ec8-9743-af574f2a33da';
    original.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)')
      .run(id, tokenHash, 'created', '2026-10-01', '2026-10-01');
    original.prepare('INSERT INTO job_preferences VALUES (?, ?, ?)').run(id, 'academic', 'lab_report');
    original.prepare('INSERT INTO job_metadata (job_id, title, objectives_json) VALUES (?, ?, ?)')
      .run(id, 'Existing lab work', '["Verify step 1"]');
    original.close();
    // SQLite-created legacy test fixtures inherit the host umask (often 0644).
    // The application correctly refuses pre-existing, world/group-readable DBs;
    // make this fixture private so this test exercises the migration itself.
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    const upgraded = open(path);
    expect(upgraded.pragma('user_version', { simple: true })).toBe(5);
    const actual = upgraded.prepare(`SELECT j.access_token_hash, j.created_at, j.updated_at,
      p.input_type, m.title, m.objectives_json FROM jobs j JOIN job_preferences p ON p.job_id=j.id
      JOIN job_metadata m ON m.job_id=j.id WHERE j.id=?`).get(id);
    expect(actual).toEqual({ access_token_hash: tokenHash,
      created_at: '2026-10-01', updated_at: '2026-10-01', input_type: 'screenshots',
      title: 'Existing lab work', objectives_json: '["Verify step 1"]' });
    expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(upgraded.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
      .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect(upgraded.prepare('SELECT applied_at FROM schema_migrations WHERE version=1').get().applied_at)
      .toBe('old-migration-time');
    upgraded.close();
    open(path); // Ensure the migrated schema passes strict reopening validation.
  });

  it('rejects corrupted legacy schemas instead of changing them', () => {
    const path = temporaryPath();
    const old = new Database(path);
    databases.push(old);
    old.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;');
    old.exec(migrations[0].sql);
    old.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(migrations[0].name, 'old');
    old.pragma('user_version = 1');
    old.exec('ALTER TABLE jobs ADD COLUMN unexpected TEXT');
    old.close();
    expect(() => openDatabase(config(path))).toThrow(DatabaseInitializationError);
    const inspect = new Database(path, { readonly: true });
    expect(inspect.pragma('user_version', { simple: true })).toBe(1);
    inspect.close();
  });

  it('rolls back a failed second migration without disturbing a legacy database', () => {
    const path = temporaryPath();
    const old = new Database(path);
    databases.push(old);
    old.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;');
    old.exec(migrations[0].sql);
    old.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(migrations[0].name, 'old');
    old.pragma('user_version = 1');
    const originalSql = migrations[1].sql;
    try {
      migrations[1].sql = 'CREATE TABLE half_migrated (id TEXT); INVALID SQL;';
      expect(() => migrateDatabase(old)).toThrow();
      expect(old.pragma('user_version', { simple: true })).toBe(1);
      expect(old.prepare("SELECT name FROM sqlite_master WHERE name='half_migrated'").get()).toBeUndefined();
      expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      migrations[1].sql = originalSql;
    }
  });

  it('allows only valid processing status transitions via internal repository operation', () => {
    const db = open();
    const repository = createJobRepository(db);
    const result = createJobService(repository).create(jobInput);
    const id = result.job.id;
    expect(repository.transitionStatus(id, 'created', 'uploaded', '2026-10-10')).toBe(true);
    expect(repository.transitionStatus(id, 'created', 'uploaded', '2026-10-11')).toBe(false);
    expect(repository.transitionStatus(id, 'uploaded', 'processing', '2026-10-12')).toBe(true);
    expect(repository.transitionStatus(id, 'processing', 'failed', '2026-10-13')).toBe(true);
    expect(repository.transitionStatus(id, 'failed', 'processing', '2026-10-14')).toBe(true);
    expect(repository.transitionStatus(id, 'processing', 'ready', '2026-10-15')).toBe(true);
    expect(() => repository.transitionStatus(id, 'ready', 'created', '2026-10-16')).toThrow(RangeError);
    expect(() => db.prepare("UPDATE jobs SET status='unknown' WHERE id=?").run(id)).toThrow();
    expect(repository.findById(id).status).toBe('ready');
  });
});
