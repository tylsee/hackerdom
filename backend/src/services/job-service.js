import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createJobSchema, updateJobSchema, jobIdSchema, accessTokenPattern } from '../schemas/job.js';
import { toPublicJob } from '../models/job-repository.js';
import { AppError } from '../utils/app-error.js';

export const hashAccessToken = (token) => createHash('sha256').update(token).digest('hex');
const dummyHash = hashAccessToken('missing-job');

export function createJobService(repository) {
  function authorize(id, token) {
    const parsedId = jobIdSchema.safeParse(id);
    if (!parsedId.success) throw new AppError(400, 'INVALID_JOB_ID', 'Job ID must be a UUID.');
    if (!accessTokenPattern.test(token ?? '')) {
      throw new AppError(401, 'UNAUTHORIZED', 'A valid job bearer token is required.');
    }
    const row = repository.findById(parsedId.data);
    const suppliedHash = Buffer.from(hashAccessToken(token), 'hex');
    const expectedHash = Buffer.from(row?.access_token_hash ?? dummyHash, 'hex');
    const authorized = timingSafeEqual(suppliedHash, expectedHash);
    // Wrong token and unknown job produce the same response.
    if (!row || !authorized) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found or access denied.');
    return row;
  }

  return Object.freeze({
    create(input) {
      const result = createJobSchema.safeParse(input);
      if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR',
          'Invalid job input. Check required preferences, allowed fields, and metadata limits.');
      }
      const accessToken = randomBytes(32).toString('base64url');
      const row = repository.create({
        id: randomUUID(), accessTokenHash: hashAccessToken(accessToken),
        timestamp: new Date().toISOString(), ...result.data,
      });
      return { job: toPublicJob(row), accessToken };
    },
    // Internal-only use after an analysis run has already been authorized and queued.
    // Access token hashes and filesystem locations are never returned.
    getInternalJobForAnalysis(id) {
      const row = repository.findById(id);
      if (!row) throw new Error('ANALYSIS_JOB_GONE');
      return toPublicJob(row);
    },
    get(id, token) {
      return toPublicJob(authorize(id, token));
    },
    update(id, token, input) {
      const existing = authorize(id, token);
      const parsed = updateJobSchema.safeParse(input);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR',
          'Invalid job update. Provide non-empty preferences or metadata using allowed fields.');
      }
      // Once evidence is uploaded, its input pipeline cannot be switched implicitly.
      if (existing.status !== 'created' && parsed.data.preferences?.inputType &&
          parsed.data.preferences.inputType !== existing.input_type) {
        throw new AppError(409, 'INPUT_TYPE_LOCKED', 'Cannot change input type after uploading evidence.');
      }
      // Avoid altering evidence-dependent preferences while a processing job is active.
      if (existing.status === 'processing') {
        throw new AppError(409, 'JOB_PROCESSING', 'Cannot edit job configuration while processing.');
      }
      const row = repository.update(existing.id, parsed.data, new Date().toISOString());
      return toPublicJob(row);
    },
    delete(id, token) {
      const existing = authorize(id, token);
      if (existing.status === 'processing') {
        throw new AppError(409, 'JOB_PROCESSING', 'Cannot delete a job while processing.');
      }
      repository.deleteById(existing.id);
    },
  });
}
