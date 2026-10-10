import { mkdtempSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/database.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createScreenshotRepository } from '../src/models/screenshot-repository.js';
import { createScreenshotService } from '../src/services/screenshot-service.js';
import { createJobService } from '../src/services/job-service.js';
import { createLogger } from '../src/utils/logger.js';

let db;
let app;
let storageRoot;
let testDir;
let jobs;
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const body = (inputType = 'screenshots') => ({ preferences: {
  writingTone: 'professional', documentType: 'sop', inputType,
} });
let fixture;

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'docuai-m3-test-'));
  storageRoot = join(testDir, 'uploads');
  fixture = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#eef4ff' } })
    .jpeg().toBuffer();
  const config = parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' });
  db = openDatabase(config);
  jobs = createJobService(createJobRepository(db));
  const screenshots = createScreenshotService(createScreenshotRepository(db), { uploadRoot: storageRoot });
  app = createApp({ config, jobService: jobs, screenshotService: screenshots,
    logger: createLogger({ level: 'silent' }) });
});

afterEach(() => {
  if (db?.open) db.close();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

const create = (input = body()) => request(app).post('/api/jobs').send(input).expect(201);
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const path = (id) => `/api/jobs/${id}/screenshots`;
const uploadOne = (id, token, buffer = fixture, name = 'capture.jpg', mime = 'image/jpeg') =>
  request(app).post(path(id)).set(auth(token)).attach('screenshots', buffer, { filename: name, contentType: mime });

const uploadTwo = (id, token) => request(app).post(path(id)).set(auth(token))
  .attach('screenshots', fixture, { filename: 'first.jpg', contentType: 'image/jpeg' })
  .attach('screenshots', fixture, { filename: 'second.jpg', contentType: 'image/jpeg' });

describe('Milestone 3 authenticated image workflow', () => {
  it('uploads in client-supplied order, records evidence metadata, and returns private real PNG content', async () => {
    const { body: { job, accessToken } } = await create();
    const response = await uploadTwo(job.id, accessToken).expect(201);
    expect(response.body.status).toBe('uploaded');
    expect(response.body.screenshots).toHaveLength(2);
    const [first, second] = response.body.screenshots;
    expect(first.order).toBe(1);
    expect(second.order).toBe(2);
    expect(first.id).not.toBe(second.id);
    expect(first.mimeType).toBe('image/png');
    expect(first.width).toBe(4);
    expect(first.height).toBe(3);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(response.body)).not.toContain(storageRoot);
    const row = db.prepare('SELECT COUNT(*) n FROM screenshots WHERE job_id=?').get(job.id);
    expect(row.n).toBe(2);
    const list = await request(app).get(path(job.id)).set(auth(accessToken)).expect(200);
    expect(list.body.screenshots).toEqual(response.body.screenshots);
    expect((await request(app).get(`/api/jobs/${job.id}`).set(auth(accessToken)).expect(200)).body.job.status).toBe('uploaded');
    const download = await request(app).get(`${path(job.id)}/${first.id}`).set(auth(accessToken))
      .buffer(true).parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.body.subarray(0, 8)).toEqual(pngMagic);
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(readdirSync(join(storageRoot, job.id)).sort()).toEqual([`${first.id}.png`, `${second.id}.png`].sort());
    if (process.platform !== 'win32') {
      expect(statSync(join(storageRoot, job.id)).mode & 0o777).toBe(0o700);
      expect(statSync(join(storageRoot, job.id, `${first.id}.png`)).mode & 0o777).toBe(0o600);
    }
  });

  it('can reorder evidence atomically and preserve order across additional uploads', async () => {
    const { body: { job, accessToken } } = await create();
    const { body: { screenshots: original } } = await uploadTwo(job.id, accessToken).expect(201);
    const opposite = [original[1].id, original[0].id];
    const ordered = await request(app).patch(`${path(job.id)}/order`).set(auth(accessToken))
      .send({ imageIds: opposite }).expect(200);
    expect(ordered.body.screenshots.map((image) => image.id)).toEqual(opposite);
    const appended = await uploadOne(job.id, accessToken).expect(201);
    expect(appended.body.screenshots.map((image) => image.id).slice(0, 2)).toEqual(opposite);
    expect(appended.body.screenshots[2].order).toBe(3);
    const invalid = await request(app).patch(`${path(job.id)}/order`).set(auth(accessToken))
      .send({ imageIds: [original[0].id, original[0].id, appended.body.screenshots[2].id] }).expect(400);
    expect(invalid.body.error.code).toBe('INVALID_SCREENSHOT_ORDER');
    const still = await request(app).get(path(job.id)).set(auth(accessToken)).expect(200);
    expect(still.body.screenshots.map((image) => image.id)).toEqual(appended.body.screenshots.map((image) => image.id));
  });

  it('deletes an image, closes the numbering gap, then returns status to created after the last image', async () => {
    const { body: { job, accessToken } } = await create();
    const { body: { screenshots: initial } } = await uploadTwo(job.id, accessToken).expect(201);
    const firstDelete = await request(app).delete(`${path(job.id)}/${initial[0].id}`)
      .set(auth(accessToken)).expect(200);
    expect(firstDelete.body.screenshots).toHaveLength(1);
    expect(firstDelete.body.screenshots[0].order).toBe(1);
    expect(existsSync(join(storageRoot, job.id, `${initial[0].id}.png`))).toBe(false);
    await request(app).delete(`${path(job.id)}/${initial[1].id}`).set(auth(accessToken)).expect(200);
    expect((await request(app).get(`/api/jobs/${job.id}`).set(auth(accessToken)).expect(200)).body.job.status).toBe('created');
    await request(app).delete(`${path(job.id)}/${initial[1].id}`).set(auth(accessToken)).expect(404);
  });

  it('isolates one job evidence from all other bearer tokens', async () => {
    const first = (await create()).body;
    const second = (await create()).body;
    const created = (await uploadOne(first.job.id, first.accessToken).expect(201)).body.screenshots[0];
    await request(app).get(`${path(first.job.id)}/${created.id}`).expect(401);
    await request(app).get(path(first.job.id)).set(auth(second.accessToken)).expect(404);
    await request(app).get(`${path(first.job.id)}/${created.id}`).set(auth(second.accessToken)).expect(404);
    await request(app).delete(`${path(first.job.id)}/${created.id}`).set(auth(second.accessToken)).expect(404);
    await request(app).patch(`${path(first.job.id)}/order`).set(auth(second.accessToken))
      .send({ imageIds: [] }).expect(404);
    await uploadOne(first.job.id, second.accessToken).expect(404);
  });

  it('rejects video jobs, invalid images, mime spoofing, missing files, and unrelated multipart fields', async () => {
    const videoJob = (await create(body('video'))).body;
    await uploadOne(videoJob.job.id, videoJob.accessToken).expect(409);
    const { body: { job, accessToken } } = await create();
    const corrupted = await uploadOne(job.id, accessToken, Buffer.from('not an image')).expect(415);
    expect(corrupted.body.error.code).toBe('INVALID_IMAGE');
    const wrongMime = await uploadOne(job.id, accessToken, fixture, 'file.jpg', 'image/svg+xml').expect(415);
    expect(wrongMime.body.error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    await request(app).post(path(job.id)).set(auth(accessToken)).expect(415);
    await request(app).post(path(job.id)).set(auth(accessToken))
      .field('extra', 'malicious').attach('screenshots', fixture, 'file.jpg').expect(400);
    await request(app).post(path(job.id)).set(auth(accessToken))
      .attach('unexpected', fixture, { filename: 'file.jpg', contentType: 'image/jpeg' }).expect(400);
    const after = await request(app).get(path(job.id)).set(auth(accessToken)).expect(200);
    expect(after.body.screenshots).toHaveLength(0);
    expect(readdirSync(join(storageRoot, '.incoming'))).toEqual([]);
  });

  it('enforces the total 12-image limit and rejects oversized bodies', async () => {
    const { body: { job, accessToken } } = await create();
    const two = await uploadTwo(job.id, accessToken).expect(201);
    let call = request(app).post(path(job.id)).set(auth(accessToken));
    for (let i = 0; i < 11; i++) call = call.attach('screenshots', fixture, { filename: `${i}.jpg`, contentType: 'image/jpeg' });
    await call.expect(413);
    expect(db.prepare('SELECT count(*) n FROM screenshots').get().n).toBe(2);
    expect((await request(app).get(path(job.id)).set(auth(accessToken)).expect(200)).body.screenshots)
      .toEqual(two.body.screenshots);
    const bigFile = Buffer.alloc(5 * 1024 * 1024 + 200, 0x41);
    await uploadOne(job.id, accessToken, bigFile).expect(413);
  });

  it('prevents edits during processing, and cannot switch the evidence type after upload', async () => {
    const { body: { job, accessToken } } = await create();
    const { body: { screenshots } } = await uploadOne(job.id, accessToken).expect(201);
    const changeType = await request(app).patch(`/api/jobs/${job.id}`).set(auth(accessToken))
      .send({ preferences: { inputType: 'video' } }).expect(409);
    expect(changeType.body.error.code).toBe('INPUT_TYPE_LOCKED');
    const repo = createJobRepository(db);
    expect(repo.transitionStatus(job.id, 'uploaded', 'processing', new Date().toISOString())).toBe(true);
    await uploadOne(job.id, accessToken).expect(409);
    await request(app).patch(`${path(job.id)}/order`).set(auth(accessToken))
      .send({ imageIds: [screenshots[0].id] }).expect(409);
    await request(app).delete(`${path(job.id)}/${screenshots[0].id}`).set(auth(accessToken)).expect(409);
  });

  it('job deletion cascades screenshot records and deletes stored evidence', async () => {
    const { body: { job, accessToken } } = await create();
    const result = (await uploadOne(job.id, accessToken).expect(201)).body;
    await request(app).delete(`/api/jobs/${job.id}`).set(auth(accessToken)).expect(204);
    expect(db.prepare('SELECT count(*) n FROM screenshots').get().n).toBe(0);
    expect(existsSync(join(storageRoot, job.id, `${result.screenshots[0].id}.png`))).toBe(false);
  });
});
