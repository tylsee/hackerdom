import { Router } from 'express';
import { requireBearer } from '../middleware/job-auth.js';
import { AppError } from '../utils/app-error.js';
import { generateDocumentSchema } from '../schemas/document.js';

export function createDocumentRouter(documentService) {
  const router = Router({ mergeParams: true });
  router.use(requireBearer);
  router.post('/document', (req, res) => {
    if (req.headers['content-type'] && !req.is('application/json')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
    }
    const parsed = generateDocumentSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(400, 'INVALID_DOCUMENT_REQUEST', 'Use an empty object or { "regenerate": true }.');
    const document = documentService.generate(req.params.id, req.jobAccessToken, parsed.data);
    res.setHeader('Location', `/api/jobs/${req.params.id}/document`);
    res.status(document.revision === 1 ? 201 : 200).json({ document });
  });
  router.get('/document', (req, res) => res.json({ document: documentService.get(req.params.id, req.jobAccessToken) }));
  return router;
}
