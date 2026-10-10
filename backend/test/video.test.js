import { mkdtempSync, rmSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { migrateDatabase, migrations } from '../src/db/migrations.js';
import { parseEnv } from '../src/config/env.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createScreenshotRepository } from '../src/models/screenshot-repository.js';
import { createVideoRepository } from '../src/models/video-repository.js';
import { createJobService } from '../src/services/job-service.js';
import { createScreenshotService } from '../src/services/screenshot-service.js';
import { createVideoService } from '../src/services/video-service.js';
import { createLogger } from '../src/utils/logger.js';
import Database from 'better-sqlite3';

const available = ['ffmpeg', 'ffprobe'].every((binary) => spawnSync(binary, ['-version']).status === 0);
let db, app, tempDir, videoService, fixture;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const body = (inputType = 'video') => ({ preferences: {
  writingTone: 'academic', documentType: 'lab_report', inputType,
} });

async function create(input = body()) {
  return (await request(app).post('/api/jobs').send(input).expect(201)).body;
}
const upload = (job, token, file = fixture, mime = 'video/mp4') =>
  request(app).post(`/api/jobs/${job.id}/video`).set(auth(token))
    .attach('video', file, { filename: 'screen.mp4', contentType: mime });
async function waitReady(jobId, token, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body: { video } } = await request(app).get(`/api/jobs/${jobId}/video`)
      .set(auth(token)).expect(200);
    if (video?.processingStatus === 'ready' || video?.processingStatus === 'failed') return video;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('Video frame extraction did not complete in test timeout');
}

(available ? describe : describe.skip)('Milestone 4 video upload and timestamped evidence', () => {
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'docuai-m4-video-'));
  const generated = join(tempDir, 'short.mp4');
  const encode = spawnSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc2=size=160x90:rate=2', '-t', '3', '-c:v', 'mpeg4', '-y', generated,
  ], { timeout: 15000 });
  if (encode.status !== 0) throw new Error('Could not generate local FFmpeg video test fixture');
  fixture = generated;
  db = openDatabase(parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }));
  const uploadRoot = join(tempDir, 'uploads');
  const jobs = createJobService(createJobRepository(db));
  const screenshots = createScreenshotService(createScreenshotRepository(db), { uploadRoot });
  videoService = createVideoService(createVideoRepository(db), { uploadRoot });
  app = createApp({ config: parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }),
    jobService: jobs, screenshotService: screenshots, videoService,
    logger: createLogger({ level: 'silent' }) });
});

afterEach(async () => {
  await videoService?.shutdown();
  if (db?.open) db.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});


  it('accepts a real MP4, extracts sorted private frames, and retains original evidence', async () => {
    const { job, accessToken } = await create();
    const uploaded = await upload(job, accessToken).expect(202);
    expect(uploaded.body.video.id).toBeTruthy();
    expect(uploaded.body.video.durationMs).toBeGreaterThan(0);
    expect(uploaded.body.video.mimeType).toBe('video/mp4');
    expect(JSON.stringify(uploaded.body)).not.toContain(tempDir);
    const result = await waitReady(job.id, accessToken);
    expect(result.processingStatus).toBe('ready');
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.frames.length).toBeLessThanOrEqual(60);
    expect(result.frames.map((f) => f.timestampMs)).toEqual(
      [...result.frames.map((f) => f.timestampMs)].sort((a, b) => a - b));
    expect(result.frames.map((f) => f.order)).toEqual(result.frames.map((_, i) => i + 1));
    expect(result.frames.every((f) => f.sha256.length === 64)).toBe(true);
    const first = await request(app).get(`/api/jobs/${job.id}/video/frames/${result.frames[0].id}`)
      .set(auth(accessToken)).buffer(true).parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200);
    expect(first.headers['content-type']).toContain('image/png');
    expect(first.body.subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    const original = await request(app).get(`/api/jobs/${job.id}/video/file`)
      .set(auth(accessToken)).expect(200);
    expect(original.headers['content-type']).toMatch(/video\/mp4/);
    expect((await request(app).get(`/api/jobs/${job.id}`).set(auth(accessToken))).body.job.status).toBe('uploaded');
    // The job-state check happens before multipart parsing. Avoid streaming a whole
    // video into an endpoint expected to reject immediately (Superagent EPIPE race).
    await request(app).post(`/api/jobs/${job.id}/video`)
      .set(auth(accessToken)).send({}).expect(409);
    await request(app).delete(`/api/jobs/${job.id}/video`).set(auth(accessToken)).expect(204);
    expect((await request(app).get(`/api/jobs/${job.id}/video`).set(auth(accessToken))).body.video).toBeNull();
    expect((await request(app).get(`/api/jobs/${job.id}`).set(auth(accessToken))).body.job.status).toBe('created');
    expect(existsSync(join(tempDir, 'uploads', job.id, 'video'))).toBe(false);
  }, 20000);

  it('enforces job type and access token, rejects corrupted and mismatched media', async () => {
    const { job, accessToken } = await create();
    const other = await create();
    // Authentication happens before upload body processing. Avoid a streaming
    // body here: early rejections can close the socket while Superagent writes.
    await request(app).post(`/api/jobs/${job.id}/video`)
      .set(auth(other.accessToken)).send({}).expect(404);
    await request(app).get(`/api/jobs/${job.id}/video`).expect(401);
    const screenshotJob = await create(body('screenshots'));
    // Input-type validation also precedes multipart parsing.
    await request(app).post(`/api/jobs/${screenshotJob.job.id}/video`)
      .set(auth(screenshotJob.accessToken)).send({}).expect(409);
    await request(app).post(`/api/jobs/${job.id}/video`).set(auth(accessToken))
      .attach('video', Buffer.from('not a video'), { filename: 'fake.mp4', contentType: 'video/mp4' })
      .expect(415);
    await upload(job, accessToken, fixture, 'video/webm').expect(415);
    await request(app).post(`/api/jobs/${job.id}/video`).set(auth(accessToken))
      .attach('video', Buffer.from('invalid file type'),
        { filename: 'file.txt', contentType: 'text/plain' }).expect(415);
    expect((await request(app).get(`/api/jobs/${job.id}/video`).set(auth(accessToken))).body.video).toBeNull();
    expect(readdirSync(join(tempDir, 'uploads', '.incoming'))).toEqual([]);
  }, 20000);

  it('protects video and frame routes from cross-job access', async () => {
    const first = await create();
    const second = await create();
    await upload(first.job, first.accessToken).expect(202);
    const video = await waitReady(first.job.id, first.accessToken);
    expect(video.processingStatus).toBe('ready');
    await request(app).get(`/api/jobs/${first.job.id}/video/file`).set(auth(second.accessToken)).expect(404);
    await request(app).get(`/api/jobs/${first.job.id}/video/frames/${video.frames[0].id}`)
      .set(auth(second.accessToken)).expect(404);
    await request(app).delete(`/api/jobs/${first.job.id}/video`).set(auth(second.accessToken)).expect(404);
    await request(app).delete(`/api/jobs/${first.job.id}`).set(auth(first.accessToken)).expect(204);
    expect(existsSync(join(tempDir, 'uploads', first.job.id))).toBe(false);
  }, 20000);
});

describe('versioned migration compatibility', () => {
  it('upgrades an existing v3 schema to v4 without altering prior tables', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.pragma('foreign_keys = OFF');
      legacy.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;`);
      for (const migration of migrations.slice(0, 3)) {
        legacy.exec(migration.sql);
        legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.name, 'original');
        legacy.pragma(`user_version = ${migration.version}`);
      }
      const id = '467833c3-d6b5-4b69-b713-3a3d40e520a6';
      legacy.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)').run(id, 'e'.repeat(64), 'created', 'old', 'old');
      legacy.prepare('INSERT INTO job_preferences VALUES (?, ?, ?, ?)').run(id, 'academic', 'lab_report', 'video');
      legacy.prepare('INSERT INTO job_metadata (job_id, title) VALUES (?, ?)').run(id, 'Original title');
      legacy.pragma('foreign_keys = ON');
      migrateDatabase(legacy);
      expect(legacy.pragma('user_version', { simple: true })).toBe(7);
      expect(legacy.prepare('SELECT title FROM job_metadata WHERE job_id = ?').get(id).title).toBe('Original title');
      expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { legacy.close(); }
  });
});
