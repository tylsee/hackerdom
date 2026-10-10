import { mkdtempSync, rmSync } from 'node:fs';
import { makeTemplateFixture } from './fixtures/template-fixture.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/database.js';
import { createLogger } from '../src/utils/logger.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createJobService } from '../src/services/job-service.js';
import { createScreenshotRepository } from '../src/models/screenshot-repository.js';
import { createScreenshotService } from '../src/services/screenshot-service.js';
import { createAnalysisRepository } from '../src/models/analysis-repository.js';
import { createAnalysisService } from '../src/services/analysis-service.js';
import { createDocumentRepository } from '../src/models/document-repository.js';
import { createDocumentService } from '../src/services/document-service.js';
import { createTemplateRepository } from '../src/models/template-repository.js';
import { createTemplateService } from '../src/services/template-service.js';
import { defaultTemplateProfile, inspectDocxTemplate, MAX_TEMPLATE_BYTES } from '../src/services/docx-template-parser.js';
import { migrations, migrateDatabase } from '../src/db/migrations.js';
import Database from 'better-sqlite3';

const fixture = makeTemplateFixture();
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let db, app, root, analysis;
let jobs, templateService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'docuai-m7-test-'));
  db = openDatabase(parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }));
  jobs = createJobService(createJobRepository(db));
  const screenshotService = createScreenshotService(createScreenshotRepository(db), { uploadRoot: root });
  analysis = createAnalysisService(createAnalysisRepository(db), {
    jobService: jobs, screenshotService,
    analyzer: { analyze: vi.fn(async ({ evidence }) => ({ steps: [{
      title: 'Enter details', instruction: 'Fill in the order row.',
      explanation: 'Records the order.', expectedResult: 'Populated cells.', caption: 'Order row.',
      evidenceIds: evidence.map((f) => f.id), startTimestampMs: null, endTimestampMs: null,
      supportStatus: 'supported', reviewNote: null,
    }] })) }, model: 'test-model', logger: createLogger({ level: 'silent' }),
  });
  const documentService = createDocumentService(createDocumentRepository(db), {
    jobService: jobs, analysisService: analysis, screenshotService,
  });
  templateService = createTemplateService(createTemplateRepository(db), {
    uploadRoot: root, jobService: jobs, documentService,
  });
  app = createApp({ config: parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }),
    jobService: jobs, screenshotService, analysisService: analysis, documentService, templateService,
    logger: createLogger({ level: 'silent' }),
  });
});
afterEach(async () => {
  await analysis.shutdown();
  if (db?.open) db.close();
  if (root) rmSync(root, { force: true, recursive: true });
});
const newJob = async () => (await request(app).post('/api/jobs').send({
  preferences: { inputType: 'screenshots', documentType: 'sop', writingTone: 'professional' },
  metadata: { title: 'Excel Workflow', processDescription: 'Document this workflow.' },
}).expect(201)).body;
const upload = (id, token, bytes = fixture, name = 'example.docx') => request(app)
  .post(`/api/jobs/${id}/template`).set(auth(token)).attach('template', bytes,
    { filename: name, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

it('extracts actual Word styles and headings without incorporating template placeholder text', () => {
  const profile = inspectDocxTemplate(fixture, 'sample.docx');
  expect(profile.styles.title).toBe('Title');
  expect(profile.styles.heading1).toBe('Heading1');
  expect(profile.templateHeadings.map((h) => h.heading)).toEqual(['Purpose', 'Procedure', 'Appendix']);
  expect(JSON.stringify(profile)).not.toContain('Replace this placeholder');
});

it('requires authorization for upload, metadata, file download, and removal', async () => {
  const a = await newJob(), b = await newJob();
  await upload(a.job.id, a.accessToken).expect(201);
  await request(app).get(`/api/jobs/${a.job.id}/template`).expect(401);
  await request(app).get(`/api/jobs/${a.job.id}/template`).set(auth(b.accessToken)).expect(404);
  await request(app).get(`/api/jobs/${a.job.id}/template/file`).set(auth(b.accessToken)).expect(404);
  await upload(a.job.id, b.accessToken).expect(404);
  await request(app).delete(`/api/jobs/${a.job.id}/template`).set(auth(b.accessToken)).expect(404);
  expect((await request(app).get(`/api/jobs/${a.job.id}/template`)
    .set(auth(a.accessToken)).expect(200)).body.template.source).toBe('uploaded');
});

it('stores the exact private DOCX and returns safe profile metadata', async () => {
  const a = await newJob();
  const res = await upload(a.job.id, a.accessToken).expect(201);
  expect(res.body.template.source).toBe('uploaded');
  expect(res.body.template.byteSize).toBe(fixture.length);
  expect(res.body.template.templateHeadings).toHaveLength(3);
  expect(res.body.template).not.toHaveProperty('storagePath');
  const downloaded = await request(app).get(`/api/jobs/${a.job.id}/template/file`)
    .set(auth(a.accessToken)).buffer(true)
    .parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
  expect(downloaded.body.equals(fixture)).toBe(true);
  expect(db.prepare('SELECT COUNT(*) AS n FROM job_templates').get().n).toBe(1);
});

it('creates a mapped layout without rewriting the generated document or inventing appendix content', async () => {
  const a = await newJob();
  await request(app).post(`/api/jobs/${a.job.id}/screenshots`).set(auth(a.accessToken))
    .attach('screenshots', await sharp({ create: { width: 80, height: 60, channels: 3,
      background: { r: 128, g: 128, b: 128 } } }).png().toBuffer(), 'step.png').expect(201);
  await request(app).post(`/api/jobs/${a.job.id}/analyze`).set(auth(a.accessToken)).send({}).expect(202);
  for (let i = 0; i < 100; i++) {
    const status = (await request(app).get(`/api/jobs/${a.job.id}/analysis`)
      .set(auth(a.accessToken)).expect(200)).body.analysis?.status;
    if (status === 'ready') break;
    if (status === 'failed') throw new Error('Analysis failed');
    await wait(10);
  }
  const original = (await request(app).post(`/api/jobs/${a.job.id}/document`)
    .set(auth(a.accessToken)).send({}).expect(201)).body.document;
  const before = (await request(app).get(`/api/jobs/${a.job.id}/document/layout`)
    .set(auth(a.accessToken)).expect(200)).body.layout;
  expect(before.template.source).toBe('default');
  await upload(a.job.id, a.accessToken).expect(201);
  const mapped = (await request(app).get(`/api/jobs/${a.job.id}/document/layout`)
    .set(auth(a.accessToken)).expect(200)).body.layout;
  expect(mapped.template.source).toBe('uploaded');
  expect(mapped.sections.map((s) => s.templateMatched)).toEqual([true, true]);
  expect(mapped.unmatchedTemplateHeadings).toContain('Appendix');
  expect(mapped.sections[1].steps[0].instruction).toBe(original.sections[1].steps[0].instruction);
  expect((await request(app).get(`/api/jobs/${a.job.id}/document`)
    .set(auth(a.accessToken)).expect(200)).body.document).toEqual(original);
  await request(app).delete(`/api/jobs/${a.job.id}/template`).set(auth(a.accessToken)).expect(200);
  expect((await request(app).get(`/api/jobs/${a.job.id}/document/layout`)
    .set(auth(a.accessToken)).expect(200)).body.layout.template.source).toBe('default');
});

it('rejects malformed, disguised, oversized, and missing DOCX uploads', async () => {
  const a = await newJob();
  expect((await upload(a.job.id, a.accessToken, Buffer.from('not a word document')).expect(415)).body.error.code)
    .toBe('INVALID_DOCX_TEMPLATE');
  await upload(a.job.id, a.accessToken, fixture, 'sample.pdf').expect(415);
  expect((await request(app).post(`/api/jobs/${a.job.id}/template`)
    .set(auth(a.accessToken)).field('note', 'bad').expect(400)).body.error.code).toBe('TEMPLATE_UPLOAD_ERROR');
  expect(() => inspectDocxTemplate(Buffer.alloc(MAX_TEMPLATE_BYTES + 1), 'x.docx')).toThrow();
  expect((await request(app).get(`/api/jobs/${a.job.id}/template`)
    .set(auth(a.accessToken)).expect(200)).body.template).toEqual(defaultTemplateProfile());
});

it('replaces a template and deletes it with its job', async () => {
  const a = await newJob();
  const first = (await upload(a.job.id, a.accessToken).expect(201)).body.template.id;
  const second = (await upload(a.job.id, a.accessToken).expect(201)).body.template.id;
  expect(second).not.toBe(first);
  expect(db.prepare('SELECT COUNT(*) AS n FROM job_templates').get().n).toBe(1);
  await request(app).delete(`/api/jobs/${a.job.id}`).set(auth(a.accessToken)).expect(204);
  expect(db.prepare('SELECT COUNT(*) AS n FROM job_templates').get().n).toBe(0);
});

describe('v6 to v7 migration', () => {
  it('preserves existing document data', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.pragma('foreign_keys = OFF');
      legacy.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL,
        applied_at TEXT NOT NULL) STRICT;`);
      for (const m of migrations.filter((m) => m.version <= 6)) {
        legacy.exec(m.sql);
        legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(m.version, m.name, 'before');
      }
      const id = 'a94dfbeb-dcad-41a9-875d-fc3e7d3712f0';
      legacy.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)').run(id, 'a'.repeat(64), 'ready', 'before', 'before');
      legacy.prepare('INSERT INTO job_preferences VALUES (?, ?, ?, ?)').run(id, 'professional', 'sop', 'screenshots');
      legacy.prepare('INSERT INTO job_metadata(job_id, title) VALUES (?, ?)').run(id, 'Original');
      legacy.prepare('INSERT INTO document_drafts VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('draft', id, 1, '{"title":"Original"}', 'before', 'before', 'before');
      legacy.pragma('user_version = 6');
      legacy.pragma('foreign_keys = ON');
      migrateDatabase(legacy);
      expect(legacy.pragma('user_version', { simple: true })).toBe(7);
      expect(legacy.prepare('SELECT content_json FROM document_drafts WHERE job_id=?').get(id).content_json)
        .toBe('{"title":"Original"}');
      expect(legacy.prepare('SELECT COUNT(*) AS n FROM job_templates').get().n).toBe(0);
      expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { legacy.close(); }
  });
});
