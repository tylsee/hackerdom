import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/database.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createJobService, hashAccessToken } from '../src/services/job-service.js';
import { createLogger } from '../src/utils/logger.js';

const input = { preferences: { writingTone: 'academic', documentType: 'lab_report' }, metadata: {
  title: ' Circuit laboratory ', processDescription: 'Visible circuit setup', intendedAudience: 'Students',
  objectives: [' Measure resistance '], additionalContext: 'User explanation, not observed evidence',
  specialRequirements: 'Do not invent measurements',
} };
let db;
let app;
let logs;

beforeEach(() => {
  const config = parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' });
  db = openDatabase(config);
  logs = [];
  app = createApp({ config, jobService: createJobService(createJobRepository(db)),
    logger: createLogger({ level: 'info', sink: { write: (line) => logs.push(JSON.parse(line)) } }),
  });
});
afterEach(() => { if (db.open) db.close(); });
const create = (body = input) => request(app).post('/api/jobs').send(body).expect(201);
const get = (id, token) => request(app).get(`/api/jobs/${id}`).set('Authorization', `Bearer ${token}`);

describe('job creation and retrieval', () => {
  it('creates a real job, persists separate preferences and metadata, and returns a one-time token', async () => {
    const response = await create();
    const { job, accessToken } = response.body;
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(job.status).toBe('created');
    expect(job.preferences).toEqual({ ...input.preferences, inputType: 'screenshots' });
    expect(job.metadata).toEqual({ ...input.metadata, title: 'Circuit laboratory',
      objectives: ['Measure resistance'], source: 'user_supplied' });
    expect(job.createdAt).toBe(job.updatedAt);
    expect(Number.isNaN(Date.parse(job.createdAt))).toBe(false);
    expect(response.headers.location).toBe(`/api/jobs/${job.id}`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count).toBe(1);
    expect(db.prepare('SELECT writing_tone, document_type FROM job_preferences').get())
      .toEqual({ writing_tone: 'academic', document_type: 'lab_report' });
    const stored = db.prepare('SELECT access_token_hash FROM jobs').get().access_token_hash;
    expect(stored).toBe(hashAccessToken(accessToken));
    expect(stored).not.toBe(accessToken);
    const fetched = await get(job.id, accessToken).expect(200);
    expect(fetched.body).toEqual({ job });
    expect(fetched.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(fetched.body)).not.toMatch(/accessToken|access_token_hash|sqlite|storage/);
  });

  it('accepts minimal preferences and persists normalized empty metadata', async () => {
    const { body } = await create({ preferences: { writingTone: 'professional', documentType: 'sop' } });
    expect(body.job.metadata).toEqual({ title: null, processDescription: null, intendedAudience: null,
      objectives: [], additionalContext: null, specialRequirements: null, source: 'user_supplied' });
  });

  it.each(['sop', 'user_manual', 'tutorial', 'lab_report'])('supports document type %s independently of tone', async (documentType) => {
    for (const writingTone of ['academic', 'professional']) {
      const { body } = await create({ preferences: { writingTone, documentType } });
      expect(body.job.preferences).toEqual({ writingTone, documentType, inputType: 'screenshots' });
    }
  });

  it('preserves literal user text without evaluating SQL or treating context as evidence', async () => {
    const title = "'); DROP TABLE jobs; --";
    const { body } = await create({ preferences: input.preferences, metadata: { title } });
    const response = await get(body.job.id, body.accessToken).expect(200);
    expect(response.body.job.metadata.title).toBe(title);
    expect(response.body.job.metadata.source).toBe('user_supplied');
    expect(db.prepare('SELECT count(*) AS count FROM jobs').get().count).toBe(1);
  });

  it('creates distinct IDs and tokens, and never logs secrets or metadata', async () => {
    const first = (await create()).body;
    const second = (await create()).body;
    expect(first.job.id).not.toBe(second.job.id);
    expect(first.accessToken).not.toBe(second.accessToken);
    await get(first.job.id, first.accessToken).expect(200);
    expect(JSON.stringify(logs)).not.toContain(first.accessToken);
    expect(JSON.stringify(logs)).not.toContain(first.job.id);
    expect(JSON.stringify(logs)).not.toContain(first.job.metadata.title);
  });
});

describe('job isolation and access control', () => {
  it('requires a bearer header, not query parameters', async () => {
    const { body } = await create();
    const response = await request(app).get(`/api/jobs/${body.job.id}`).expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.headers['www-authenticate']).toContain('Bearer');
    await request(app).get(`/api/jobs/${body.job.id}?accessToken=${body.accessToken}`).expect(401);
  });

  it.each(['Basic abc', 'Bearer short', 'Bearer ' + 'x'.repeat(44), 'Bearer ' + '!'.repeat(43)])
    ('rejects malformed authorization %s', async (authorization) => {
      const { body } = await create();
      await request(app).get(`/api/jobs/${body.job.id}`).set('Authorization', authorization).expect(401);
    });

  it('does not allow a token from a different job', async () => {
    const first = (await create()).body;
    const second = (await create()).body;
    const wrong = await get(first.job.id, second.accessToken).expect(404);
    const absent = await get(randomUUID(), second.accessToken).expect(404);
    expect(wrong.body.error.code).toBe('JOB_NOT_FOUND');
    expect(wrong.body.error.message).toBe(absent.body.error.message);
  });

  it('rejects an invalid job ID when authorization is syntactically valid', async () => {
    const { body } = await create();
    const response = await get('not-a-uuid', body.accessToken).expect(400);
    expect(response.body.error.code).toBe('INVALID_JOB_ID');
  });

  it('accepts case-insensitive Bearer and canonicalizes UUID case', async () => {
    const { body } = await create();
    await request(app).get(`/api/jobs/${body.job.id.toUpperCase()}`)
      .set('Authorization', `bearer ${body.accessToken}`).expect(200);
  });

  it('keeps uploads disabled when no screenshot storage service is configured', async () => {
    const { body } = await create();
    await request(app).get('/api/jobs').expect(404);
    await request(app).post(`/api/jobs/${body.job.id}/screenshots`).expect(404);
  });
});

describe('strict creation validation', () => {
  it.each([
    {}, [], null,
    { preferences: {} },
    { preferences: { ...input.preferences, writingTone: 'Academic' } },
    { preferences: { ...input.preferences, documentType: 'pdf' } },
    { preferences: { ...input.preferences, auditEnabled: true } },
    { preferences: { ...input.preferences, inputType: 'livestream' } },
    { ...input, status: 'complete' },
    { ...input, metadata: { source: 'supported' } },
    { ...input, metadata: { title: ' ' } },
    { ...input, metadata: { title: 'x'.repeat(201) } },
    { ...input, metadata: { objectives: 'not-an-array' } },
    { ...input, metadata: { objectives: [''] } },
    { ...input, metadata: { objectives: Array(21).fill('a') } },
    { ...input, metadata: { additionalContext: 'x'.repeat(8001) } },
    { ...input, metadata: null },
  ])('rejects invalid body %# without partial writes', async (body) => {
    const response = await request(app).post('/api/jobs').set('Content-Type', 'application/json')
      .send(JSON.stringify(body)).expect(400);
    expect(['VALIDATION_ERROR', 'INVALID_JSON']).toContain(response.body.error.code);
    for (const table of ['jobs', 'job_preferences', 'job_metadata']) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count).toBe(0);
    }
  });

  it('does not reflect unknown keys or user values in validation errors', async () => {
    const response = await request(app).post('/api/jobs').send({ 'private-key-name': 'private-value' }).expect(400);
    expect(JSON.stringify([response.body, logs])).not.toMatch(/private-key-name|private-value/);
  });

  it('requires JSON content type', async () => {
    const response = await request(app).post('/api/jobs').type('form').send({ writingTone: 'academic' }).expect(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('sanitizes unexpected database errors rather than claiming a job was saved', async () => {
    db.close();
    const response = await request(app).post('/api/jobs').send(input).expect(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/database connection|stack|sqlite/);
  });
});


describe('input selection and authenticated job mutation', () => {
  const patch = (id, token, payload) => request(app).patch(`/api/jobs/${id}`)
    .set('Authorization', `Bearer ${token}`).send(payload);
  const remove = (id, token) => request(app).delete(`/api/jobs/${id}`)
    .set('Authorization', `Bearer ${token}`);

  it.each(['screenshots', 'video'])('creates a %s job with the persisted inputType', async (inputType) => {
    const { body } = await create({ ...input, preferences: { ...input.preferences, inputType } });
    expect(body.job.preferences.inputType).toBe(inputType);
    expect(db.prepare('SELECT input_type FROM job_preferences WHERE job_id = ?').get(body.job.id).input_type)
      .toBe(inputType);
  });

  it('supports independent partial updates, clearing nullable fields, and retaining unmentioned fields', async () => {
    const { body } = await create();
    const { job, accessToken } = body;
    const updated = await patch(job.id, accessToken, {
      preferences: { inputType: 'video', writingTone: 'professional' },
      metadata: { title: null, objectives: ['Calibrate instrument'], specialRequirements: 'No invented values' },
    }).expect(200);
    expect(updated.body.job.preferences).toEqual({ writingTone: 'professional', documentType: 'lab_report', inputType: 'video' });
    expect(updated.body.job.metadata.title).toBeNull();
    expect(updated.body.job.metadata.processDescription).toBe(input.metadata.processDescription);
    expect(updated.body.job.metadata.objectives).toEqual(['Calibrate instrument']);
    expect(updated.body.job.metadata.source).toBe('user_supplied');
    expect(updated.body.job.createdAt).toBe(job.createdAt);
    expect(await get(job.id, accessToken).then((r) => r.body.job)).toEqual(updated.body.job);
    expect(updated.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify([updated.body, logs])).not.toContain(accessToken);
  });

  it.each([{}, { preferences: {} }, { metadata: {} }, { status: 'ready' },
    { preferences: { inputType: 'invalid' } }, { metadata: { objectives: [''] } },
    { metadata: { source: 'verified' } }, { metadata: { title: '   ' } },
  ])('rejects invalid PATCH payload without modifying the job', async (update) => {
    const { body } = await create();
    await patch(body.job.id, body.accessToken, update).expect(400);
    const fetched = await get(body.job.id, body.accessToken).expect(200);
    expect(fetched.body.job).toEqual(body.job);
  });

  it('requires JSON for PATCH and never accepts a bearer in query parameters', async () => {
    const { body } = await create();
    await request(app).patch(`/api/jobs/${body.job.id}`)
      .set('Authorization', `Bearer ${body.accessToken}`)
      .type('form').send({ title: 'No' }).expect(415);
    await request(app).patch(`/api/jobs/${body.job.id}?accessToken=${body.accessToken}`)
      .send({ metadata: { title: 'No' } }).expect(401);
  });

  it('does not allow cross-job reads, edits, or deletes', async () => {
    const first = (await create()).body;
    const second = (await create()).body;
    await patch(first.job.id, second.accessToken, { metadata: { title: 'attack' } }).expect(404);
    await remove(first.job.id, second.accessToken).expect(404);
    await patch(first.job.id, 'bad', { metadata: { title: 'attack' } }).expect(401);
    await remove(first.job.id, 'bad').expect(401);
    expect((await get(first.job.id, first.accessToken).expect(200)).body.job.metadata.title).toBe('Circuit laboratory');
  });

  it('deletes the job and cascading database records, and returns 204 without a body', async () => {
    const { body } = await create();
    const response = await remove(body.job.id, body.accessToken).expect(204);
    expect(response.text).toBe('');
    for (const name of ['jobs', 'job_preferences', 'job_metadata']) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${name}`).get().count).toBe(0);
    }
    await get(body.job.id, body.accessToken).expect(404);
    await remove(body.job.id, body.accessToken).expect(404);
  });

  it('prevents mutation of a job currently processing', async () => {
    const { body } = await create();
    const repository = createJobRepository(db);
    expect(repository.transitionStatus(body.job.id, 'created', 'uploaded', new Date().toISOString())).toBe(true);
    expect(repository.transitionStatus(body.job.id, 'uploaded', 'processing', new Date().toISOString())).toBe(true);
    await patch(body.job.id, body.accessToken, { metadata: { title: 'Changed' } }).expect(409);
    await remove(body.job.id, body.accessToken).expect(409);
    expect(repository.transitionStatus(body.job.id, 'processing', 'ready', new Date().toISOString())).toBe(true);
  });
});
