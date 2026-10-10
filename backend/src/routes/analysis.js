import { Router } from 'express';
import { requireBearer } from '../middleware/job-auth.js';
import { AppError } from '../utils/app-error.js';

export function createAnalysisRouter(analysisService) {
  const router = Router({ mergeParams: true });
  router.use(requireBearer);
  router.post('/analyze', (req, res) => {
    // No request body needed; all data comes from the authenticated job.
    if (req.headers['content-type'] && !req.is('application/json')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only application/json is accepted.');
    }
    if (req.body && Object.keys(req.body).length) {
      throw new AppError(400, 'INVALID_REQUEST_BODY', 'Analysis starts with an empty JSON object.');
    }
    const analysis = analysisService.start(req.params.id, req.jobAccessToken);
    res.status(202).json({ analysis });
  });
  router.get('/analysis', (req, res) => res.json({
    analysis: analysisService.get(req.params.id, req.jobAccessToken),
  }));
  router.get('/steps', (req, res) => res.json(analysisService.steps(req.params.id, req.jobAccessToken)));
  return router;
}
