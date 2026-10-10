import { Router } from 'express';
import packageInfo from '../../package.json' with { type: 'json' };

export function createHealthRouter() {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      status: 'ok',
      service: 'docuai-backend',
      version: packageInfo.version,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });
  return router;
}
