import { Router } from 'express';
import { AppError } from '../utils/app-error.js';
import { requireBearer } from '../middleware/job-auth.js';
import { createScreenshotsRouter } from './screenshots.js';
import { createVideoRouter } from './video.js';
import { createAnalysisRouter } from './analysis.js';
import { createDocumentRouter } from './document.js';
import { createTemplateRouter } from './templates.js';

function requireJson(req, _res, next) {
  if (!req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'This endpoint requires application/json.'));
  }
  next();
}

export function createJobsRouter(jobService, screenshotService, videoService, analysisService, documentService, templateService) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post('/', requireJson, (req, res) => {
    const result = jobService.create(req.body);
    res.setHeader('Location', `/api/jobs/${result.job.id}`);
    res.status(201).json(result);
  });
  if (screenshotService) router.use('/:id/screenshots', createScreenshotsRouter(jobService, screenshotService));
  if (videoService) router.use('/:id/video', createVideoRouter(jobService, videoService));
  if (analysisService) router.use('/:id', createAnalysisRouter(analysisService));
  if (documentService) router.use('/:id', createDocumentRouter(documentService));
  if (templateService) {
    router.use('/:id/template', createTemplateRouter(jobService, templateService));
    router.get('/:id/document/layout', requireBearer, (req, res) => {
      res.json({ layout: templateService.layout(req.params.id, req.jobAccessToken) });
    });
  }
  router.get('/:id', requireBearer, (req, res) => {
    res.status(200).json({ job: jobService.get(req.params.id, req.jobAccessToken) });
  });
  router.patch('/:id', requireBearer, requireJson, (req, res) => {
    res.status(200).json({ job: jobService.update(req.params.id, req.jobAccessToken, req.body) });
  });
  router.delete('/:id', requireBearer, async (req, res) => {
    const existing = jobService.get(req.params.id, req.jobAccessToken);
    videoService?.assertCanDeleteJob(existing.id);
    jobService.delete(req.params.id, req.jobAccessToken);
    if (screenshotService) await screenshotService.purgeJob(existing.id);
    if (templateService) await templateService.purgeJob(existing.id);
    res.status(204).end();
  });
  return router;
}
