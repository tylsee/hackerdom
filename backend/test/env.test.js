import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, parseEnv } from '../src/config/env.js';

describe('environment validation', () => {
  it('provides safe defaults without requiring Gemini secrets', () => {
    expect(parseEnv({})).toEqual({
      nodeEnv: 'development', host: '127.0.0.1', port: 3000, logLevel: 'info',
      jsonBodyLimitBytes: 65536, shutdownTimeoutMs: 10000, corsOrigins: [],
      databasePath: fileURLToPath(new URL('../storage/docuai.sqlite', import.meta.url)),
      databaseBusyTimeoutMs: 5000, geminiApiKey: '', geminiModel: 'gemini-2.5-flash',
    });
  });

  it('parses explicit settings and deduplicates exact origins', () => {
    const config = parseEnv({ NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '8080',
      LOG_LEVEL: 'warn', JSON_BODY_LIMIT_BYTES: '131072', SHUTDOWN_TIMEOUT_MS: '5000',
      CORS_ORIGINS: ' https://frontend.example, http://localhost:5173,https://frontend.example ',
    });
    expect(config.port).toBe(8080);
    expect(config.corsOrigins).toEqual(['https://frontend.example', 'http://localhost:5173']);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.corsOrigins)).toBe(true);
  });

  it.each(['0', '65536', 'abc', '-1', '3.14', '', '0x123', '3e3'])('rejects invalid PORT=%s', (port) => {
    expect(() => parseEnv({ PORT: port })).toThrow(ConfigurationError);
  });

  it.each([
    { NODE_ENV: 'staging' }, { LOG_LEVEL: 'verbose' }, { JSON_BODY_LIMIT_BYTES: '1' },
    { SHUTDOWN_TIMEOUT_MS: '0' }, { HOST: '' }, { HOST: 'http://localhost' },
    { CORS_ORIGINS: '*' }, { CORS_ORIGINS: 'https://example.com/path' },
    { CORS_ORIGINS: 'https://example.com/' }, { CORS_ORIGINS: 'https://user:pass@example.com' },
    { CORS_ORIGINS: 'ftp://example.com' }, { CORS_ORIGINS: 'not-an-origin' },
  ])('rejects invalid settings %j', (values) => {
    expect(() => parseEnv(values)).toThrow(ConfigurationError);
  });

  it('resolves database paths relative to backend, not the current working directory', () => {
    expect(parseEnv({ DATABASE_PATH: 'storage/custom.sqlite' }).databasePath)
      .toBe(fileURLToPath(new URL('../storage/custom.sqlite', import.meta.url)));
    expect(parseEnv({ DATABASE_PATH: ':memory:', NODE_ENV: 'test' }).databasePath).toBe(':memory:');
  });

  it.each([
    { DATABASE_PATH: '' }, { DATABASE_PATH: 'bad\0path' }, { DATABASE_BUSY_TIMEOUT_MS: '-1' },
    { DATABASE_BUSY_TIMEOUT_MS: '30001' }, { DATABASE_PATH: ':memory:', NODE_ENV: 'production' },
  ])('rejects invalid database configuration %j', (env) => {
    expect(() => parseEnv(env)).toThrow(ConfigurationError);
  });

  it('reports invalid setting names without echoing environment secrets', () => {
    try {
      parseEnv({ PORT: 'secret-value', GEMINI_API_KEY: 'private-gemini-key' });
      expect.unreachable('Configuration should have failed');
    } catch (error) {
      expect(error.message).toBe('Invalid environment configuration: PORT');
      expect(JSON.stringify(error)).not.toMatch(/secret-value|private-gemini-key/);
    }
  });

  it('loads a supplied .env file while preserving process environment precedence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docuai-env-test-'));
    const envFile = join(dir, '.env');
    try {
      writeFileSync(envFile, 'PORT=4567\nLOG_LEVEL=warn\n');
      const env = { PORT: '3456' };
      const config = loadConfig({ env, envFile });
      expect(config.port).toBe(3456);
      expect(config.logLevel).toBe('warn');
    } finally {
      unlinkSync(envFile);
      rmdirSync(dir);
    }
  });

  it('uses defaults when the optional .env file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docuai-no-env-test-'));
    try {
      expect(loadConfig({ env: {}, envFile: join(dir, 'missing.env') }).port).toBe(3000);
    } finally {
      rmdirSync(dir);
    }
  });
});
