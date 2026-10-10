import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function requestContext(logger) {
  return (req, res, next) => {
    // Do not trust user-controlled correlation IDs in logs.
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const startedAt = performance.now();
    res.once('finish', () => {
      logger.info('http_request', {
        requestId: req.requestId,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      });
    });
    next();
  };
}
