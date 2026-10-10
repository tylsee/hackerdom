import { Router } from 'express';
import { AppError } from '../utils/app-error.js';
import { requireBearer } from '../middleware/job-auth.js';
import { createScreenshotsRouter } from './screenshots.js';
import { createVideoRouter } from './video.js';
import { createAnalysisRouter } from './analysis.js';

function requireJson(req, _res, next) {
  if (!req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'This endpoint requires application/json.'));
  }
  next();
}

export function createJobsRouter(jobService, screenshotService, videoService, analysisService) {
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
    res.status(204).end();
  });
  return router;
}
