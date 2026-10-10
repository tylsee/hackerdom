import { AppError } from '../utils/app-error.js';
import { accessTokenPattern } from '../schemas/job.js';

export function requireBearer(req, res, next) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get('Authorization') ?? '');
  if (!match || !accessTokenPattern.test(match[1])) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="docuai-job"');
    return next(new AppError(401, 'UNAUTHORIZED', 'A valid job bearer token is required.'));
  }
  req.jobAccessToken = match[1];
  next();
}
