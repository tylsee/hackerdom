import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from '../utils/app-error.js';
import { requireBearer } from '../middleware/job-auth.js';
import { MAX_SOURCE_BYTES, MAX_SCREENSHOTS } from '../services/screenshot-service.js';

const screenshotIdsSchema = z.object({
  imageIds: z.array(z.uuid()).max(MAX_SCREENSHOTS),
}).strict();
const acceptedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function createScreenshotsRouter(jobService, screenshotService) {
  const router = Router({ mergeParams: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: screenshotService.temporaryDirectory,
      filename: (_req, _file, callback) => callback(null, randomUUID() + '.incoming'),
    }),
    fileFilter: (_req, file, callback) => {
      if (!acceptedMimeTypes.has(file.mimetype)) {
        return callback(new AppError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Only PNG, JPEG and WebP screenshots are supported.'));
      }
      callback(null, true);
    },
    limits: { fileSize: MAX_SOURCE_BYTES, files: MAX_SCREENSHOTS, fields: 0, parts: MAX_SCREENSHOTS },
  }).array('screenshots', MAX_SCREENSHOTS);

  router.use(requireBearer, (req, _res, next) => {
    const job = jobService.get(req.params.id, req.jobAccessToken);
    req.authenticatedJob = job;
    next();
  });

  function ensureEditable(req) {
    if (req.authenticatedJob.preferences.inputType !== 'screenshots') {
      throw new AppError(409, 'WRONG_INPUT_TYPE', 'This job expects a screen recording.');
    }
    if (!['created', 'uploaded'].includes(req.authenticatedJob.status)) {
      throw new AppError(409, 'JOB_NOT_UPLOADABLE', 'Screenshot edits are not allowed in the current job state.');
    }
  }

  router.get('/', (req, res) => {
    res.json({ screenshots: screenshotService.list(req.authenticatedJob.id) });
  });

  router.post('/', (req, res, next) => {
    ensureEditable(req);
    if (!req.is('multipart/form-data')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data with screenshots as the file field.');
    }
    upload(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        const tooLarge = ['LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_PART_COUNT'].includes(error.code);
        return next(new AppError(tooLarge ? 413 : 400, 'UPLOAD_LIMIT_ERROR',
          tooLarge ? 'Screenshot upload limits were exceeded.' : 'Invalid screenshot upload fields.'));
      }
      next(error);
    });
  }, async (req, res) => {
    try {
      const screenshots = await screenshotService.add(req.authenticatedJob.id, req.files);
      res.status(201).json({ jobId: req.authenticatedJob.id, status: 'uploaded', screenshots });
    } finally {
      // The temporary source files must never be retained, even on validation/DB errors.
      await Promise.all((req.files ?? []).map((file) => rm(file.path, { force: true }).catch(() => {})));
    }
  });

  router.patch('/order', (req, res) => {
    ensureEditable(req);
    if (!req.is('application/json')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json for screenshot ordering.');
    }
    const parsed = screenshotIdsSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_SCREENSHOT_ORDER', 'Provide an imageIds array of UUIDs.');
    const screenshots = screenshotService.reorder(req.authenticatedJob.id, parsed.data.imageIds);
    res.json({ screenshots });
  });

  router.get('/:imageId', async (req, res) => {
    const imageId = req.params.imageId.toLowerCase();
    const image = await screenshotService.getFile(req.authenticatedJob.id, imageId);
    res.type('png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(image);
  });

  router.delete('/:imageId', async (req, res) => {
    ensureEditable(req);
    const screenshots = await screenshotService.remove(req.authenticatedJob.id, req.params.imageId.toLowerCase());
    res.status(200).json({ screenshots });
  });

  return router;
}
