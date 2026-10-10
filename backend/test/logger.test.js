import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/utils/logger.js';

function capture(level) {
  const lines = [];
  const logger = createLogger({ level, sink: { write: (line) => lines.push(JSON.parse(line)) } });
  return { logger, lines };
}

describe('structured logging', () => {
  it('emits structured, timestamped logs with level filtering', () => {
    const { logger, lines } = capture('warn');
    logger.debug('debug');
    logger.info('info');
    logger.warn('validation', { requestId: 'test-id', code: 'INVALID_JSON' });
    logger.error('failure', { statusCode: 500 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ timestamp: expect.any(String), level: 'warn', event: 'validation',
      requestId: 'test-id', code: 'INVALID_JSON' });
  });

  it('never serializes unapproved sensitive fields', () => {
    const { logger, lines } = capture('info');
    logger.info('request', { method: 'GET', authorization: 'secret-auth', body: 'secret-body',
      path: '/private/path', env: { GEMINI_API_KEY: 'secret-key' }, error: new Error('secret-error') });
    expect(JSON.stringify(lines)).not.toMatch(/secret|private/);
    expect(lines[0].method).toBe('GET');
  });

  it('supports silent logging in tests', () => {
    const { logger, lines } = capture('silent');
    logger.error('failure');
    expect(lines).toEqual([]);
  });
});
