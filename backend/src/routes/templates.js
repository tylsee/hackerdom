import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../utils/app-error.js';
import { requireBearer } from '../middleware/job-auth.js';
import { MAX_TEMPLATE_BYTES } from '../services/docx-template-parser.js';

export function createTemplateRouter(jobService, templateService) {
  const router = Router({ mergeParams: true });
  router.use(requireBearer, (req, _res, next) => {
    req.authenticatedJob = jobService.get(req.params.id, req.jobAccessToken);
    next();
  });
  const upload = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: MAX_TEMPLATE_BYTES, files: 1, fields: 0, parts: 1 },
  }).single('template');
  router.get('/', (req, res) => res.json({ template: templateService.get(req.params.id, req.jobAccessToken) }));
  router.post('/', (req, res, next) => {
    if (!req.is('multipart/form-data')) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data.');
    upload(req, res, (error) => {
      if (error instanceof multer.MulterError) return next(new AppError(
        error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
        'TEMPLATE_UPLOAD_ERROR', 'Template exceeds 8 MiB or the upload fields are invalid.'));
      next(error);
    });
  }, async (req, res) => {
    const template = await templateService.upload(req.params.id, req.jobAccessToken, req.file);
    res.status(201).json({ template });
  });
  router.get('/file', async (req, res) => {
    const { bytes } = await templateService.download(req.params.id, req.jobAccessToken);
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="template.docx"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  });
  router.delete('/', async (req, res) => {
    const template = await templateService.remove(req.params.id, req.jobAccessToken);
    res.json({ template });
  });
  return router;
}
