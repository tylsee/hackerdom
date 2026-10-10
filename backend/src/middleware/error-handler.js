import { AppError } from '../utils/app-error.js';

export function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested endpoint does not exist.'));
}

function publicError(error) {
  if (error instanceof AppError) return error;
  if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
    return new AppError(503, 'DATABASE_BUSY', 'Database is busy. Retry the request shortly.');
  }
  switch (error.type) {
    case 'entity.parse.failed':
      return new AppError(400, 'INVALID_JSON', 'Request body contains malformed JSON.');
    case 'entity.too.large':
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the configured limit.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError(415, 'UNSUPPORTED_ENCODING', 'Request body encoding is not supported.');
    case 'request.aborted':
    case 'request.size.invalid':
      return new AppError(400, 'INVALID_REQUEST_BODY', 'Request body is incomplete or invalid.');
    default:
      return new AppError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected server error occurred.');
  }
}

export function errorHandler(logger) {
  // Express requires all four arguments to recognize error middleware.
  return (error, req, res, _next) => {
    const safeError = publicError(error);
    const logLevel = safeError.statusCode >= 500 ? 'error' : 'warn';
    logger[logLevel]('http_error', {
      requestId: req.requestId,
      statusCode: safeError.statusCode,
      code: safeError.code,
    });
    // A partial response cannot be replaced with JSON. Close the connection without
    // forwarding private error details to Express's default stderr logger.
    if (res.headersSent) return res.destroy();
    return res.status(safeError.statusCode).json({
      error: { code: safeError.code, message: safeError.message, requestId: req.requestId },
    });
  };
}
