import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createScreenshotRepository } from '../src/models/screenshot-repository.js';
import { createAnalysisRepository } from '../src/models/analysis-repository.js';
import { createJobService } from '../src/services/job-service.js';
import { createScreenshotService } from '../src/services/screenshot-service.js';
import { createAnalysisService } from '../src/services/analysis-service.js';
import { createGeminiAnalyzer } from '../src/services/gemini-analyzer.js';
import { validateAnalysis } from '../src/schemas/analysis.js';
import { createLogger } from '../src/utils/logger.js';

let db, app, root, jobs, screenshots, analysisService, analyzer, returned;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const jobBody = (kind = 'screenshots') => ({
  preferences: { writingTone: 'academic', documentType: 'lab_report', inputType: kind },
  metadata: { title: 'Lab exercise', processDescription: 'Unverified supplied explanation' },
});
const step = (evidenceIds, overrides = {}) => ({
  title: 'Observe the application', instruction: 'Inspect the visible application state.',
  explanation: 'The screenshot shows the current screen.', expectedResult: null,
  caption: 'Application state shown in screenshot.', evidenceIds,
  startTimestampMs: null, endTimestampMs: null,
  supportStatus: 'supported', reviewNote: null, ...overrides,
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(jobId, token, wanted = ['ready', 'failed']) {
  for (let tries = 0; tries < 100; tries++) {
    const { body } = await request(app).get(`/api/jobs/${jobId}/analysis`)
      .set(auth(token)).expect(200);
    if (wanted.includes(body.analysis?.status)) return body.analysis;
    await pause(10);
  }
  throw new Error('Timed out waiting for analysis worker');
}
const create = async (kind = 'screenshots') =>
  (await request(app).post('/api/jobs').send(jobBody(kind)).expect(201)).body;
const png = () => sharp({ create: { width: 120, height: 80, channels: 3, background: '#0055aa' } })
  .png().toBuffer();
async function upload(jobId, token) {
  const image = await png();
  return (await request(app).post(`/api/jobs/${jobId}/screenshots`)
    .set(auth(token)).attach('screenshots', image, { filename: 'example.png', contentType: 'image/png' })
    .expect(201)).body.screenshots;
}
function setup(fakeVideo = null, fakeAnalyzer = undefined) {
  const config = parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' });
  db = openDatabase(config);
  root = mkdtempSync(join(tmpdir(), 'docuai-m5-'));
  jobs = createJobService(createJobRepository(db));
  screenshots = createScreenshotService(createScreenshotRepository(db), { uploadRoot: join(root, 'uploads') });
  returned = null;
  analyzer = fakeAnalyzer === undefined ? {
    analyze: vi.fn(async ({ evidence }) => returned ?? { steps: [step([evidence[0].id])] }),
  } : fakeAnalyzer;
  analysisService = createAnalysisService(createAnalysisRepository(db), { jobService: jobs,
    screenshotService: screenshots, videoService: fakeVideo, analyzer, model: 'test-vision',
    logger: createLogger({ level: 'silent' }) });
  app = createApp({ config, jobService: jobs, screenshotService: screenshots,
    videoService: fakeVideo, analysisService, logger: createLogger({ level: 'silent' }) });
}
beforeEach(() => setup());
afterEach(async () => {
  await analysisService?.shutdown();
  if (db?.open) db.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('Milestone 5 screenshot evidence analysis', () => {
  it('requires a job token, uploaded evidence, and returns asynchronous steps', async () => {
    const { job, accessToken } = await create();
    await request(app).post(`/api/jobs/${job.id}/analyze`).expect(401);
    await request(app).post(`/api/jobs/${job.id}/analyze`).set(auth(accessToken)).expect(409);
    const images = await upload(job.id, accessToken);
    const started = await request(app).post(`/api/jobs/${job.id}/analyze`)
      .set(auth(accessToken)).send({}).expect(202);
    expect(['queued', 'processing', 'ready']).toContain(started.body.analysis.status);
    const status = await wait(job.id, accessToken);
    expect(status.status).toBe('ready');
    expect(status.model).toBe('test-vision');
    const response = await request(app).get(`/api/jobs/${job.id}/steps`)
      .set(auth(accessToken)).expect(200);
    expect(response.body.steps).toHaveLength(1);
    expect(response.body.steps[0].evidenceImageIds).toEqual([images[0].id]);
    expect(response.body.steps[0].videoFrameIds).toEqual([]);
    expect(response.body.steps[0].caption).toBeTruthy();
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
    expect(analyzer.analyze.mock.calls[0][0].job.preferences.writingTone).toBe('academic');
    expect(analyzer.analyze.mock.calls[0][0].evidence[0].data.subarray(0, 8))
      .toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(db.prepare('SELECT count(*) AS n FROM analysis_steps').get().n).toBe(1);
    expect((await request(app).get(`/api/jobs/${job.id}`).set(auth(accessToken))).body.job.status).toBe('ready');
    await request(app).post(`/api/jobs/${job.id}/analyze`).set(auth(accessToken)).expect(409);
  });

  it('isolates step and analysis data by bearer token', async () => {
    const first = await create();
    const second = await create();
    await upload(first.job.id, first.accessToken);
    await request(app).post(`/api/jobs/${first.job.id}/analyze`).set(auth(first.accessToken)).expect(202);
    await wait(first.job.id, first.accessToken);
    await request(app).get(`/api/jobs/${first.job.id}/steps`).set(auth(second.accessToken)).expect(404);
    await request(app).get(`/api/jobs/${first.job.id}/analysis`).expect(401);
    await request(app).post(`/api/jobs/${first.job.id}/analyze`).set(auth(second.accessToken)).expect(404);
  });

  it('rejects invented evidence IDs and retains an explicit failed status', async () => {
    const { job, accessToken } = await create();
    await upload(job.id, accessToken);
    returned = { steps: [step([randomUUID()])] };
    await request(app).post(`/api/jobs/${job.id}/analyze`).set(auth(accessToken)).expect(202);
    const status = await wait(job.id, accessToken);
    expect(status.status).toBe('failed');
    expect(status.errorCode).toBe('INVALID_EVIDENCE_REFERENCE');
    expect((await request(app).get(`/api/jobs/${job.id}/steps`).set(auth(accessToken))).body.steps).toEqual([]);
    expect((await request(app).get(`/api/jobs/${job.id}`).set(auth(accessToken))).body.job.status).toBe('failed');
  });

  it('permits retry after malformed output without changing evidence', async () => {
    const { job, accessToken } = await create();
    const images = await upload(job.id, accessToken);
    returned = { steps: [{ bad: true }] };
    await request(app).post(`/api/jobs/${job.id}/analyze`).set(auth(accessToken)).expect(202);
    expect((await wait(job.id, accessToken)).errorCode).toBe('INVALID_AI_RESULT');
    returned = { steps: [step([images[0].id])] };
    await request(app).post(`/api/jobs/${job.id}/analyze`).set(auth(accessToken)).expect(202);
    expect((await wait(job.id, accessToken)).status).toBe('ready');
  });

  it('reports only a safe Gemini HTTP status when the provider rejects analysis', async () => {
    const { job, accessToken } = await create();
    await upload(job.id, accessToken);
    // Intentionally sensitive provider message must never be returned by the API.
    analyzer.analyze.mockRejectedValueOnce(Object.assign(new Error('secret upstream diagnostic'), {
      name: 'ApiError', status: 400,
    }));
    await request(app).post(`/api/jobs/${job.id}/analyze`)
      .set(auth(accessToken)).send({}).expect(202);
    const failed = await wait(job.id, accessToken);
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('GEMINI_HTTP_400');
    expect(JSON.stringify(failed)).not.toContain('secret upstream diagnostic');
    // Corrected requests can still be retried without re-uploading evidence.
    await request(app).post(`/api/jobs/${job.id}/analyze`)
      .set(auth(accessToken)).send({}).expect(202);
    expect((await wait(job.id, accessToken)).status).toBe('ready');
  });

  it('does not start an analysis without configured Gemini backend', async () => {
    const { job, accessToken } = await create();
    await upload(job.id, accessToken);
    const service = createAnalysisService(createAnalysisRepository(db), { jobService: jobs,
      screenshotService: screenshots, analyzer: null });
    const separate = createApp({ config: parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }),
      jobService: jobs, screenshotService: screenshots, analysisService: service,
      logger: createLogger({ level: 'silent' }) });
    const response = await request(separate).post(`/api/jobs/${job.id}/analyze`)
      .set(auth(accessToken)).expect(503);
    expect(response.body.error.code).toBe('GEMINI_NOT_CONFIGURED');
  });

  it('cascades saved steps when a completed job is deleted', async () => {
    const { job, accessToken } = await create();
    await upload(job.id, accessToken);
    await request(app).post(`/api/jobs/${job.id}/analyze`).set(auth(accessToken)).expect(202);
    await wait(job.id, accessToken);
    await request(app).delete(`/api/jobs/${job.id}`).set(auth(accessToken)).expect(204);
    expect(db.prepare('SELECT count(*) AS n FROM analyses').get().n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM analysis_steps').get().n).toBe(0);
  });
});

describe('video semantics and deterministic verification', () => {
  it('validates chronological sequence, forbidden evidence IDs, and timestamps', () => {
    const a = randomUUID(), b = randomUUID();
    const evidence = [{ id: a, timestampMs: 0 }, { id: b, timestampMs: 1000 }];
    expect(() => validateAnalysis({ steps: [step([b]), step([a])] }, evidence, 'video', 2000))
      .toThrow('NONCHRONOLOGICAL_STEPS');
    expect(() => validateAnalysis({ steps: [step([a, a])] }, evidence, 'video', 2000))
      .toThrow('DUPLICATE_EVIDENCE_REFERENCE');
    expect(() => validateAnalysis({ steps: [step([b], { startTimestampMs: 1300, endTimestampMs: 1200 })] },
      evidence, 'video', 2000)).toThrow('INVALID_STEP_TIMESTAMPS');
    expect(() => validateAnalysis({ steps: [step([a], { startTimestampMs: 0, endTimestampMs: 150 })] },
      evidence, 'screenshots')).toThrow('SCREENSHOT_TIMESTAMPS_UNAVAILABLE');
    expect(validateAnalysis({ steps: [step([], { supportStatus: 'supported' })] },
      evidence, 'video', 2000)[0].supportStatus).toBe('needs_review');
  });

  it('uses real timestamped frame evidence for video jobs', async () => {
    const evidenceId = randomUUID();
    const frame = await png();
    const video = { list: () => ({ processingStatus: 'ready', durationMs: 2400,
      frames: [{ id: evidenceId, order: 1, timestampMs: 1000 }] }),
      getFrame: async () => frame, assertCanDeleteJob: () => {},
    };
    await analysisService.shutdown();
    db.close();
    rmSync(root, { recursive: true, force: true });
    setup(video);
    const { job, accessToken } = await create('video');
    // The test's fake video captures prepared evidence; the DB job status is
    // marked uploaded as a real successful video upload would do.
    db.prepare("UPDATE jobs SET status='uploaded' WHERE id = ?").run(job.id);
    returned = { steps: [step([evidenceId], { startTimestampMs: 500, endTimestampMs: 1200 })] };
    await request(app).post(`/api/jobs/${job.id}/analyze`).set(auth(accessToken)).expect(202);
    expect((await wait(job.id, accessToken)).status).toBe('ready');
    const result = (await request(app).get(`/api/jobs/${job.id}/steps`).set(auth(accessToken))).body.steps[0];
    expect(result.videoFrameIds).toEqual([evidenceId]);
    expect(result.evidenceImageIds).toEqual([]);
    expect(result.startTimestampMs).toBe(500);
  });
});

describe('Gemini SDK adapter', () => {
  it('sends actual encoded images and constrained JSON output through the SDK interface', async () => {
    const captured = [];
    const fake = { models: { generateContent: async (args) => {
      captured.push(args);
      return { text: JSON.stringify({ steps: [step([randomUUID()])] }) };
    } } };
    const adapter = createGeminiAnalyzer({ apiKey: 'test-key', model: 'test-vision',
      clientFactory: async () => fake });
    const job = { ...jobBody(), preferences: jobBody().preferences, metadata: jobBody().metadata };
    await adapter.analyze({ job, evidence: [{ id: randomUUID(), order: 1, timestampMs: null, data: await png() }] });
    expect(captured[0].contents[0].parts[2].inlineData.mimeType).toBe('image/jpeg');
    expect(captured[0].contents[0].parts[2].inlineData.data.length).toBeGreaterThan(100);
    expect(captured[0].config.responseMimeType).toBe('application/json');
    expect(captured[0].config.responseJsonSchema.properties.steps).toBeTruthy();
    expect(JSON.stringify(captured[0])).not.toContain('test-key');
  });


  it('retries schema HTTP 400 only once with JSON MIME and preserves the images', async () => {
    const calls = [];
    const firstError = Object.assign(new Error('provider omitted'), { name: 'ApiError', status: 400 });
    const evidenceId = randomUUID();
    const result = { steps: [step([evidenceId])] };
    const fake = { models: { generateContent: vi.fn(async (args) => {
      calls.push(args);
      if (calls.length === 1) throw firstError;
      return { text: JSON.stringify(result) };
    }) } };
    const fallback = vi.fn();
    const adapter = createGeminiAnalyzer({ apiKey: 'test-key', model: 'test-vision',
      clientFactory: async () => fake, onSchemaFallback: fallback });
    const parsed = await adapter.analyze({ job: jobBody(), evidence: [{
      id: evidenceId, order: 1, timestampMs: null, data: await png(),
    }] });
    expect(parsed).toEqual(result);
    expect(fake.models.generateContent).toHaveBeenCalledTimes(2);
    expect(calls[0].config.responseJsonSchema).toBeTruthy();
    expect(calls[1].config.responseJsonSchema).toBeUndefined();
    expect(calls[1].config.responseMimeType).toBe('application/json');
    expect(calls[0].config.temperature).toBeUndefined();
    expect(calls[1].config.temperature).toBeUndefined();
    expect(calls[1].contents[0].parts[2].inlineData)
      .toEqual(calls[0].contents[0].parts[2].inlineData);
    expect(fallback).toHaveBeenCalledOnce();
    expect(validateAnalysis(parsed, [{ id: evidenceId, timestampMs: null }], 'screenshots'))
      .toHaveLength(1);
  });

  it('does not retry quota, permission, or network errors', async () => {
    const fallback = vi.fn();
    for (const error of [
      Object.assign(new Error('rate-limited'), { name: 'ApiError', status: 429 }),
      Object.assign(new Error('forbidden'), { name: 'ApiError', status: 403 }),
      Object.assign(new Error('connection refused'), { code: 'ECONNRESET' }),
    ]) {
      const fake = { models: { generateContent: vi.fn(async () => { throw error; }) } };
      const adapter = createGeminiAnalyzer({ apiKey: 'test-key', model: 'test-vision',
        clientFactory: async () => fake, onSchemaFallback: fallback });
      await expect(adapter.analyze({ job: jobBody(), evidence: [{
        id: randomUUID(), order: 1, timestampMs: null, data: await png(),
      }] })).rejects.toBe(error);
      expect(fake.models.generateContent).toHaveBeenCalledOnce();
    }
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not treat schema fallback as permission to accept malformed AI JSON', async () => {
    let n = 0;
    const fake = { models: { generateContent: vi.fn(async () => {
      n += 1;
      if (n === 1) throw Object.assign(new Error('invalid argument'), { name: 'ApiError', status: 400 });
      return { text: 'not-json' };
    }) } };
    const adapter = createGeminiAnalyzer({ apiKey: 'test-key', model: 'test-vision',
      clientFactory: async () => fake });
    await expect(adapter.analyze({ job: jobBody(), evidence: [{
      id: randomUUID(), order: 1, timestampMs: null, data: await png(),
    }] })).rejects.toThrow('INVALID_AI_JSON');
    expect(fake.models.generateContent).toHaveBeenCalledTimes(2);
  });

});
