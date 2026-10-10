import Database from 'better-sqlite3';

// Never modify an already released migration: existing databases carry its history.
export const migrations = [
  {
    version: 1,
    name: 'jobs_preferences_metadata',
    sql: `
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY NOT NULL,
        access_token_hash TEXT NOT NULL CHECK(length(access_token_hash) = 64),
        status TEXT NOT NULL DEFAULT 'created' CHECK(status = 'created'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE job_preferences (
        job_id TEXT PRIMARY KEY NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        writing_tone TEXT NOT NULL CHECK(writing_tone IN ('academic', 'professional')),
        document_type TEXT NOT NULL CHECK(document_type IN ('sop', 'user_manual', 'tutorial', 'lab_report'))
      ) STRICT;
      CREATE TABLE job_metadata (
        job_id TEXT PRIMARY KEY NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT,
        process_description TEXT,
        intended_audience TEXT,
        objectives_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(objectives_json) AND json_type(objectives_json) = 'array'),
        additional_context TEXT,
        special_requirements TEXT,
        source TEXT NOT NULL DEFAULT 'user_supplied' CHECK(source = 'user_supplied')
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'input_type_and_processing_statuses',
    // SQLite cannot remove a CHECK constraint with ALTER COLUMN. Rebuild jobs in
    // one transaction, temporarily disabling FK enforcement WITHOUT deleting child
    // rows. All child-table data and bearer-token hashes are preserved.
    sql: `
      CREATE TABLE jobs_next (
        id TEXT PRIMARY KEY NOT NULL,
        access_token_hash TEXT NOT NULL CHECK(length(access_token_hash) = 64),
        status TEXT NOT NULL DEFAULT 'created'
          CHECK(status IN ('created', 'uploaded', 'processing', 'ready', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO jobs_next(id, access_token_hash, status, created_at, updated_at)
        SELECT id, access_token_hash, status, created_at, updated_at FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_next RENAME TO jobs;
      ALTER TABLE job_preferences ADD COLUMN input_type TEXT NOT NULL DEFAULT 'screenshots'
        CHECK(input_type IN ('screenshots', 'video'));
    `,
  },
  {
    version: 3,
    name: 'screenshots_with_ordered_evidence',
    sql: `
      CREATE TABLE screenshots (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 12 OR position BETWEEN 101 AND 112),
        mime_type TEXT NOT NULL CHECK(mime_type = 'image/png'),
        byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 20971520),
        width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 20000),
        height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 20000),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
        created_at TEXT NOT NULL,
        UNIQUE(job_id, position)
      ) STRICT;
      CREATE INDEX screenshots_job_idx ON screenshots(job_id);
    `,
  },
  {
    version: 4,
    name: 'videos_and_timestamped_frames',
    sql: `
      CREATE TABLE job_videos (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
        storage_ext TEXT NOT NULL CHECK(storage_ext IN ('mp4', 'mov', 'webm')),
        mime_type TEXT NOT NULL CHECK(mime_type IN ('video/mp4', 'video/quicktime', 'video/webm')),
        byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 83886080),
        duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 1 AND 180000),
        width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 4096),
        height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2160),
        frame_status TEXT NOT NULL DEFAULT 'queued'
          CHECK(frame_status IN ('queued', 'processing', 'ready', 'failed')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE video_frames (
        id TEXT PRIMARY KEY NOT NULL,
        video_id TEXT NOT NULL REFERENCES job_videos(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 60),
        timestamp_ms INTEGER NOT NULL CHECK(timestamp_ms >= 0),
        byte_size INTEGER NOT NULL CHECK(byte_size > 0),
        width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 4096),
        height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2160),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
        UNIQUE(video_id, position)
      ) STRICT;
      CREATE INDEX video_frames_video_idx ON video_frames(video_id);
    `,
  },
  {
    version: 5,
    name: 'gemini_analysis_and_evidence_grounded_steps',
    sql: `
      CREATE TABLE analyses (
        job_id TEXT PRIMARY KEY NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'ready', 'failed')),
        model TEXT NOT NULL,
        error_code TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;
      CREATE TABLE analysis_steps (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL REFERENCES analyses(job_id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 100),
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        explanation TEXT NOT NULL,
        expected_result TEXT,
        caption TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json) AND json_type(evidence_ids_json) = 'array'),
        start_timestamp_ms INTEGER CHECK(start_timestamp_ms IS NULL OR start_timestamp_ms >= 0),
        end_timestamp_ms INTEGER CHECK(end_timestamp_ms IS NULL OR end_timestamp_ms >= 0),
        support_status TEXT NOT NULL CHECK(support_status IN ('supported', 'needs_review', 'unsupported')),
        review_note TEXT,
        UNIQUE(job_id, position)
      ) STRICT;
      CREATE INDEX analysis_steps_job_idx ON analysis_steps(job_id);
    `,
  },
];

const historySchema = `CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;`;
const normalizeSql = (sql) => sql.replace(/\s+/g, '').replace(/;$/, '').toLowerCase();
const snapshotCache = new Map();

// Derive the expected schema for EACH migration version by replaying trusted DDL
// in an empty SQLite database, including SQLite's own ALTER TABLE SQL rewrite.
// This validates v1 *before* upgrading it, and v2 on every subsequent startup.
function expectedSnapshot(version) {
  if (snapshotCache.has(version)) return snapshotCache.get(version);
  const reference = new Database(':memory:');
  try {
    reference.exec(historySchema);
    for (const entry of migrations.filter((migration) => migration.version <= version)) {
      reference.exec(entry.sql);
    }
    const snapshot = new Map(reference.prepare(
      "SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
    ).all().map(({ name, type, sql }) => [name, { type, sql: normalizeSql(sql) }]));
    snapshotCache.set(version, snapshot);
    return snapshot;
  } finally {
    reference.close();
  }
}

function validateSchema(db, version) {
  const expected = expectedSnapshot(version);
  const actual = db.prepare(
    "SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
  ).all();
  if (actual.length !== expected.size || actual.some((object) =>
    object.type !== expected.get(object.name)?.type || normalizeSql(object.sql ?? '') !== expected.get(object.name)?.sql)) {
    throw new Error('Unrecognized database schema');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) {
    throw new Error('Database foreign key integrity check failed');
  }
}

export function migrateDatabase(db) {
  const originalForeignKeys = db.pragma('foreign_keys', { simple: true });
  const currentVersion = db.pragma('user_version', { simple: true });
  if (currentVersion > migrations.at(-1).version) {
    throw new Error('Database schema is newer than this backend');
  }

  // PRAGMA foreign_keys cannot be changed inside a transaction. The rebuild
  // requires FK checks OFF; restore them even if an upgrade fails.
  const requiresRebuild = currentVersion < 2;
  if (requiresRebuild) db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true });
      if (version === 0) {
        const objects = db.prepare(
          "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        ).all();
        if (objects.length) throw new Error('Refusing to migrate an unrecognized database');
        db.exec(historySchema);
      } else {
        const history = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
        if (history.length !== version || history.some((row, i) =>
          row.version !== migrations[i]?.version || row.name !== migrations[i]?.name)) {
          throw new Error('Unrecognized migration history');
        }
        validateSchema(db, version);
      }

      for (const migration of migrations.filter((entry) => entry.version > version)) {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, new Date().toISOString());
        db.pragma(`user_version = ${migration.version}`);
      }
      validateSchema(db, migrations.at(-1).version);
    }).immediate();
  } finally {
    if (requiresRebuild) db.pragma(`foreign_keys = ${originalForeignKeys ? 'ON' : 'OFF'}`);
  }
}
