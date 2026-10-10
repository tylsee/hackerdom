import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { AppError } from '../utils/app-error.js';
import { requireBearer } from '../middleware/job-auth.js';
import { MAX_VIDEO_BYTES } from '../services/video-service.js';

const supportedTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function createVideoRouter(jobService, videoService) {
  const router = Router({ mergeParams: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: videoService.temporaryDirectory,
      filename: (_req, _file, callback) => callback(null, `${randomUUID()}.video-incoming`),
    }),
    fileFilter: (_req, file, callback) => {
      if (!supportedTypes.has(file.mimetype)) {
        return callback(new AppError(415, 'UNSUPPORTED_VIDEO_TYPE', 'Only MP4, MOV and WebM recordings are supported.'));
      }
      callback(null, true);
    },
    limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 0, parts: 1 },
  }).single('video');

  router.use(requireBearer, (req, _res, next) => {
    req.authenticatedJob = jobService.get(req.params.id, req.jobAccessToken);
    next();
  });

  router.get('/', (req, res) => {
    res.json({ video: videoService.list(req.authenticatedJob.id) });
  });

  router.post('/', (req, res, next) => {
    if (req.authenticatedJob.preferences.inputType !== 'video') {
      throw new AppError(409, 'WRONG_INPUT_TYPE', 'This job expects screenshots.');
    }
    if (req.authenticatedJob.status !== 'created') {
      throw new AppError(409, 'JOB_NOT_UPLOADABLE', 'Video upload is not allowed in this job state.');
    }
    if (!req.is('multipart/form-data')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data with video as the file field.');
    }
    upload(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        const tooLarge = ['LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_PART_COUNT'].includes(error.code);
        return next(new AppError(tooLarge ? 413 : 400, 'VIDEO_UPLOAD_LIMIT',
          tooLarge ? 'Video upload exceeds the configured limit.' : 'Invalid video upload fields.'));
      }
      next(error);
    });
  }, async (req, res) => {
    try {
      const video = await videoService.add(req.authenticatedJob.id, req.file);
      res.status(202).json({ jobId: req.authenticatedJob.id, video });
    } finally {
      if (req.file) await rm(req.file.path, { force: true }).catch(() => {});
    }
  });

  router.get('/file', async (req, res) => {
    const { data, mime } = await videoService.getOriginal(req.authenticatedJob.id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(mime).send(data);
  });

  router.get('/frames/:frameId', async (req, res) => {
    const frame = await videoService.getFrame(req.authenticatedJob.id, req.params.frameId.toLowerCase());
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('png').send(frame);
  });

  router.delete('/', async (req, res) => {
    await videoService.remove(req.authenticatedJob.id);
    res.status(204).end();
  });
  return router;
}
