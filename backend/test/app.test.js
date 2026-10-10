import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { createJobRepository } from '../src/models/job-repository.js';
import { createJobService } from '../src/services/job-service.js';

const databases = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); });
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { requestContext } from '../src/middleware/request-context.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/utils/app-error.js';

function setup(overrides = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const config = parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', ...overrides });
  const db = openDatabase(config);
  databases.push(db);
  const jobService = createJobService(createJobRepository(db));
  return { app: createApp({ config, logger, jobService }), logger };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('health and request context', () => {
  it('applies the validated environment to Express instead of reading an unrelated global', () => {
    const db = openDatabase(parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }));
    databases.push(db);
    const app = createApp({ config: parseEnv({ NODE_ENV: 'production' }),
      jobService: createJobService(createJobRepository(db)) });
    expect(app.get('env')).toBe('production');
  });

  it('returns real liveness information with no dependency or secret claims', async () => {
    const { app } = setup();
    const response = await request(app).get('/health').expect(200).expect('Content-Type', /json/);
    expect(response.body).toEqual({
      status: 'ok', service: 'docuai-backend', version: '0.7.0',
      timestamp: expect.any(String), uptimeSeconds: expect.any(Number),
    });
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toMatch(uuid);
  });

  it('sends security headers and hides the Express signature', async () => {
    const { app } = setup();
    const response = await request(app).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  it('generates unique IDs rather than trusting client-controlled IDs', async () => {
    const { app } = setup();
    const first = await request(app).get('/health').set('X-Request-Id', 'client-controlled');
    const second = await request(app).get('/health');
    expect(first.headers['x-request-id']).toMatch(uuid);
    expect(second.headers['x-request-id']).not.toBe(first.headers['x-request-id']);
  });

  it('logs only safe request fields, excluding URLs, query values, auth and bodies', async () => {
    const { app, logger } = setup();
    await request(app).post('/unknown?api_key=secret-query')
      .set('Authorization', 'Bearer secret-token').send({ secret: 'secret-body' });
    const logText = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
    expect(logText).not.toMatch(/secret-query|secret-token|secret-body|unknown/);
    expect(logger.info).toHaveBeenCalledWith('http_request', expect.objectContaining({
      requestId: expect.stringMatching(uuid), method: 'POST', statusCode: 404, durationMs: expect.any(Number),
    }));
  });

  it('supports HEAD health checks without a response body', async () => {
    const { app } = setup();
    const response = await request(app).head('/health').expect(200);
    expect(response.text).toBeUndefined();
  });
});

describe('CORS integration boundaries', () => {
  it('allows configured origins and exposes the correlation header', async () => {
    const { app } = setup({ CORS_ORIGINS: 'http://localhost:5173' });
    const response = await request(app).get('/health').set('Origin', 'http://localhost:5173').expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-expose-headers']).toBe('X-Request-Id,Location');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('handles allowed preflight requests', async () => {
    const { app } = setup({ CORS_ORIGINS: 'http://localhost:5173' });
    const response = await request(app).options('/api/jobs')
      .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').expect(204);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-headers']).toBe('Content-Type,Authorization');
  });

  it('denies unconfigured origins with a JSON error', async () => {
    const { app } = setup();
    const response = await request(app).get('/health').set('Origin', 'https://untrusted.example').expect(403);
    expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not use substring matching for origins', async () => {
    const { app } = setup({ CORS_ORIGINS: 'http://localhost:5173' });
    await request(app).get('/health').set('Origin', 'http://localhost:5173.evil.example').expect(403);
  });

  it('permits CLI requests without emitting wildcard CORS headers', async () => {
    const { app } = setup();
    const response = await request(app).get('/health').expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('public error responses', () => {
  it('returns consistent 404 JSON without reflecting the requested URL', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/not-implemented/private-id').expect(404);
    expect(response.body).toEqual({ error: {
      code: 'NOT_FOUND', message: 'The requested endpoint does not exist.',
      requestId: response.headers['x-request-id'],
    } });
    expect(JSON.stringify(response.body)).not.toContain('private-id');
  });

  it('does not pretend that later milestone endpoints exist', async () => {
    const { app } = setup();
    await request(app).post('/api/jobs/example/analyze').send({}).expect(404);
    await request(app).post('/health').send({}).expect(404);
  });

  it('returns 400 for malformed JSON without leaking parser details', async () => {
    const { app } = setup();
    const response = await request(app).post('/api/jobs').set('Content-Type', 'application/json')
      .send('{"private":"sensitive",').expect(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(response.body)).not.toMatch(/sensitive|SyntaxError|stack/);
  });

  it('rejects primitive JSON with the strict JSON parser', async () => {
    const { app } = setup();
    const response = await request(app).post('/api/jobs').set('Content-Type', 'application/json')
      .send('42').expect(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 when a JSON body exceeds the configured byte limit', async () => {
    const { app } = setup({ JSON_BODY_LIMIT_BYTES: '1024' });
    const response = await request(app).post('/api/jobs').send({ value: 'x'.repeat(2048) }).expect(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects compressed request bodies rather than inflating untrusted content', async () => {
    const { app } = setup();
    const response = await request(app).post('/api/jobs').set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip').send('{}').expect(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_ENCODING');
  });

  it('keeps an in-limit JSON request distinct from an oversized request', async () => {
    const { app } = setup({ JSON_BODY_LIMIT_BYTES: '1024' });
    await request(app).post('/api/not-implemented').send({ value: 'small' }).expect(404);
  });

  it('catches rejected async handlers and sanitizes internal errors in production', async () => {
    // Test-only route; no deliberate failure endpoint is added to production.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const app = express();
    app.set('env', 'production');
    app.use(requestContext(logger));
    app.get('/failure', async () => { throw new Error('secret-key /private/internal/path'); });
    app.use(errorHandler(logger));
    const response = await request(app).get('/failure').expect(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify([response.body, logger.error.mock.calls])).not.toMatch(/secret-key|private|stack/);
    expect(logger.error).toHaveBeenCalledWith('http_error', expect.objectContaining({ statusCode: 500 }));
  });

  it('closes partial responses without forwarding private errors to the default handler', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const res = { headersSent: true, destroy: vi.fn() };
    const next = vi.fn();
    errorHandler(logger)(new Error('secret /private/path'), { requestId: 'test-id' }, res, next);
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/secret|private/);
  });

  it('preserves deliberate safe application errors', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const app = express();
    app.use(requestContext(logger));
    app.get('/failure', () => { throw new AppError(409, 'CONFLICT', 'The resource changed.'); });
    app.use(errorHandler(logger));
    const response = await request(app).get('/failure').expect(409);
    expect(response.body.error.message).toBe('The resource changed.');
    expect(logger.warn).toHaveBeenCalled();
  });
});
