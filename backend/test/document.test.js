import request from 'supertest';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { migrateDatabase, migrations } from '../src/db/migrations.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createJobService } from '../src/services/job-service.js';
import { createScreenshotRepository } from '../src/models/screenshot-repository.js';
import { createScreenshotService } from '../src/services/screenshot-service.js';
import { createAnalysisRepository } from '../src/models/analysis-repository.js';
import { createAnalysisService } from '../src/services/analysis-service.js';
import { createDocumentRepository } from '../src/models/document-repository.js';
import { createDocumentService } from '../src/services/document-service.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const image = () => sharp({ create: { width: 72, height: 48, channels: 3,
  background: { r: 45, g: 67, b: 110 } } }).png().toBuffer();
const jobInput = (type = 'screenshots') => ({
  preferences: { writingTone: 'professional', documentType: 'sop', inputType: type },
  metadata: { title: 'Excel Order Workflow', processDescription: 'Record customer orders.',
    intendedAudience: 'New employees', objectives: ['Enter order data accurately'],
    specialRequirements: 'Use the supplied order sheet.' },
});
const analyzed = (ids, overrides = {}) => ({
  title: 'Populate order row', instruction: 'Enter the visible order values.',
  explanation: 'The populated row records the order.', expectedResult: 'The row is populated.',
  caption: 'Completed order row.', evidenceIds: ids,
  startTimestampMs: null, endTimestampMs: null, supportStatus: 'supported',
  reviewNote: null, ...overrides,
});
let db, app, folder, jobs, screenshots, analysis, documentService, analyzer, videoStub;
async function waitReady(id, token) {
  for (let i = 0; i < 100; i++) {
    const res = await request(app).get(`/api/jobs/${id}/analysis`).set(auth(token)).expect(200);
    if (res.body.analysis?.status === 'ready') return;
    if (res.body.analysis?.status === 'failed') throw new Error(res.body.analysis.errorCode);
    await pause(10);
  }
  throw new Error('AI test worker did not complete');
}
const createJob = async (type = 'screenshots') => (await request(app).post('/api/jobs')
  .send(jobInput(type)).expect(201)).body;
async function upload(id, token, count = 1) {
  let req = request(app).post(`/api/jobs/${id}/screenshots`).set(auth(token));
  for (let i = 0; i < count; i++) {
    req = req.attach('screenshots', await image(), { filename: `${i}.png`, contentType: 'image/png' });
  }
  return (await req.expect(201)).body.screenshots;
}
async function analyzeJob(id, token) {
  await request(app).post(`/api/jobs/${id}/analyze`).set(auth(token)).send({}).expect(202);
  await waitReady(id, token);
}
function setup(video = null) {
  db = openDatabase(parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }));
  folder = mkdtempSync(join(tmpdir(), 'docuai-m6-'));
  jobs = createJobService(createJobRepository(db));
  screenshots = createScreenshotService(createScreenshotRepository(db), { uploadRoot: join(folder, 'uploads') });
  videoStub = video;
  analyzer = { analyze: vi.fn(async ({ evidence, job }) => ({
    steps: [analyzed(evidence.map((item) => item.id), job.preferences.inputType === 'video'
      ? { startTimestampMs: 0, endTimestampMs: 1800 } : {} )],
  })) };
  analysis = createAnalysisService(createAnalysisRepository(db), {
    jobService: jobs, screenshotService: screenshots, videoService: videoStub,
    analyzer, model: 'fake-model', logger: createLogger({ level: 'silent' }),
  });
  documentService = createDocumentService(createDocumentRepository(db), {
    jobService: jobs, analysisService: analysis, screenshotService: screenshots, videoService: videoStub,
  });
  app = createApp({ config: parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }),
    jobService: jobs, screenshotService: screenshots, videoService: videoStub,
    analysisService: analysis, documentService, logger: createLogger({ level: 'silent' }),
  });
}
beforeEach(() => setup());
afterEach(async () => {
  await analysis?.shutdown();
  if (db?.open) db.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe('Milestone 6 document drafting', () => {
  it('generates a persistent SOP from real screenshots without a second Gemini request', async () => {
    const { job, accessToken } = await createJob();
    const uploaded = await upload(job.id, accessToken, 2);
    await analyzeJob(job.id, accessToken);
    const originalCalls = analyzer.analyze.mock.calls.length;
    const res = await request(app).post(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).send({}).expect(201);
    const doc = res.body.document;
    expect(res.headers.location).toBe(`/api/jobs/${job.id}/document`);
    expect(doc.revision).toBe(1);
    expect(doc.documentType).toBe('sop');
    expect(doc.writingTone).toBe('professional');
    expect(doc.title).toBe('Excel Order Workflow');
    expect(doc.stepCount).toBe(1);
    expect(doc.reviewCount).toBe(0);
    expect(doc.sections.map((s) => s.heading)).toEqual([
      'Purpose', 'Intended Audience', 'Objectives', 'Special Requirements', 'Procedure',
    ]);
    const step = doc.sections.at(-1).steps[0];
    expect(step.selectedEvidence).toEqual({
      id: uploaded[1].id, kind: 'screenshot', order: 2, timestampMs: null,
      retrievalPath: `/api/jobs/${job.id}/screenshots/${uploaded[1].id}`,
    });
    expect(step.instruction).toBe('Enter the visible order values.');
    expect(step.caption).toBe('Completed order row.');
    expect(analyzer.analyze).toHaveBeenCalledTimes(originalCalls);
    expect((await request(app).get(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).expect(200)).body.document).toEqual(doc);
    expect(db.prepare('SELECT revision FROM document_drafts WHERE job_id = ?').get(job.id).revision).toBe(1);
  });

  it('denies cross-job reads/generation and requires completed analysis', async () => {
    const a = await createJob(), b = await createJob();
    await request(app).get(`/api/jobs/${a.job.id}/document`).expect(401);
    await request(app).get(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).expect(404);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).send({}).expect(409);
    await upload(a.job.id, a.accessToken);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).send({}).expect(409);
    await analyzeJob(a.job.id, a.accessToken);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(b.accessToken)).send({}).expect(404);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).send({ regenerate: 'true' }).expect(400);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).send({ regenerate: false, hidden: true }).expect(400);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).set('Content-Type', 'text/plain').send('hello').expect(415);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).send({}).expect(201);
    await request(app).get(`/api/jobs/${a.job.id}/document`)
      .set(auth(b.accessToken)).expect(404);
    await request(app).post(`/api/jobs/${a.job.id}/document`)
      .set(auth(a.accessToken)).send({}).expect(409);
  });

  it('explicit regeneration replaces the snapshot but preserves draft ID and increases revision', async () => {
    const { job, accessToken } = await createJob();
    await upload(job.id, accessToken);
    await analyzeJob(job.id, accessToken);
    const first = (await request(app).post(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).send({}).expect(201)).body.document;
    await request(app).patch(`/api/jobs/${job.id}`).set(auth(accessToken))
      .send({ metadata: { title: 'Updated title' } }).expect(200);
    const unchanged = (await request(app).get(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).expect(200)).body.document;
    expect(unchanged.title).toBe(first.title);
    const regenerated = (await request(app).post(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).send({ regenerate: true }).expect(200)).body.document;
    expect(regenerated.id).toBe(first.id);
    expect(regenerated.createdAt).toBe(first.createdAt);
    expect(regenerated.revision).toBe(2);
    expect(regenerated.title).toBe('Updated title');
  });

  it('shows uncertainty explicitly and never invents missing overview sections', async () => {
    const { job, accessToken } = (await request(app).post('/api/jobs').send({
      preferences: { writingTone: 'academic', documentType: 'lab_report', inputType: 'screenshots' },
      metadata: {},
    }).expect(201)).body;
    await upload(job.id, accessToken);
    analyzer.analyze.mockImplementationOnce(async ({ evidence }) => ({ steps: [
      analyzed([evidence[0].id], { supportStatus: 'needs_review',
        reviewNote: 'Opening action is not visible.' }),
    ] }));
    await analyzeJob(job.id, accessToken);
    const doc = (await request(app).post(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).send({}).expect(201)).body.document;
    expect(doc.title).toBe('Untitled Lab Report');
    expect(doc.sections.map((s) => s.heading)).toEqual(['Method', 'Evidence Review']);
    expect(doc.reviewCount).toBe(1);
    expect(doc.sections.at(-1).notes[0].note).toBe('Opening action is not visible.');
  });

  it('uses real timestamped video frames and retains estimated timestamps', async () => {
    const a = randomUUID(), b = randomUUID();
    const video = { list: () => ({ processingStatus: 'ready', durationMs: 2000,
      frames: [{ id: a, order: 1, timestampMs: 0 }, { id: b, order: 2, timestampMs: 1200 }] }),
      getFrame: async () => image(), assertCanDeleteJob: () => {},
    };
    await analysis.shutdown(); db.close(); rmSync(folder, { recursive: true, force: true });
    setup(video);
    const { job, accessToken } = await createJob('video');
    db.prepare("UPDATE jobs SET status='uploaded' WHERE id=?").run(job.id);
    await analyzeJob(job.id, accessToken);
    const doc = (await request(app).post(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).send({}).expect(201)).body.document;
    const step = doc.sections.find((s) => s.kind === 'procedure').steps[0];
    expect(step.selectedEvidence).toEqual({
      id: b, order: 2, kind: 'video_frame', timestampMs: 1200,
      retrievalPath: `/api/jobs/${job.id}/video/frames/${b}`,
    });
    expect(step.startTimestampMs).toBe(0);
    expect(step.endTimestampMs).toBe(1800);
  });

  it('refuses to draft when analyzed evidence no longer exists in storage metadata', async () => {
    const { job, accessToken } = await createJob();
    await upload(job.id, accessToken);
    await analyzeJob(job.id, accessToken);
    db.prepare('DELETE FROM screenshots WHERE job_id = ?').run(job.id);
    const response = await request(app).post(`/api/jobs/${job.id}/document`)
      .set(auth(accessToken)).send({}).expect(409);
    expect(response.body.error.code).toBe('DOCUMENT_EVIDENCE_MISSING');
    expect(db.prepare('SELECT COUNT(*) AS n FROM document_drafts').get().n).toBe(0);
  });

  it('deletes associated document drafts when job is deleted', async () => {
    const { job, accessToken } = await createJob();
    await upload(job.id, accessToken);
    await analyzeJob(job.id, accessToken);
    await request(app).post(`/api/jobs/${job.id}/document`).set(auth(accessToken)).send({}).expect(201);
    await request(app).delete(`/api/jobs/${job.id}`).set(auth(accessToken)).expect(204);
    expect(db.prepare('SELECT COUNT(*) AS n FROM document_drafts').get().n).toBe(0);
  });
});

describe('Milestone 6 migration compatibility', () => {
  it('migrates v5 to v6 without altering existing analysis or evidence tables', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.pragma('foreign_keys=OFF');
      legacy.exec(`CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
      ) STRICT;`);
      for (const migration of migrations.filter((item) => item.version <= 5)) {
        legacy.exec(migration.sql);
        legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
          .run(migration.version, migration.name, `older-${migration.version}`);
      }
      legacy.pragma('user_version=5');
      const id = randomUUID();
      legacy.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)')
        .run(id, 'a'.repeat(64), 'ready', 'before', 'before');
      legacy.prepare('INSERT INTO job_preferences VALUES (?, ?, ?, ?)')
        .run(id, 'professional', 'sop', 'screenshots');
      legacy.prepare('INSERT INTO job_metadata(job_id, title) VALUES (?, ?)')
        .run(id, 'Preserved job');
      legacy.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, 'ready', 'working-model', null, 'before', 'before', 'before');
      legacy.pragma('foreign_keys=ON');
      migrateDatabase(legacy);
      expect(legacy.pragma('user_version', { simple: true })).toBe(7);
      expect(legacy.prepare('SELECT status, model FROM analyses WHERE job_id=?').get(id))
        .toEqual({ status: 'ready', model: 'working-model' });
      expect(legacy.prepare('SELECT title FROM job_metadata WHERE job_id=?').get(id).title)
        .toBe('Preserved job');
      expect(legacy.prepare('SELECT COUNT(*) AS n FROM document_drafts').get().n).toBe(0);
      expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { legacy.close(); }
  });
});
