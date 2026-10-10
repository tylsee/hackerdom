import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createHealthRouter } from './routes/health.js';
import { createJobsRouter } from './routes/jobs.js';
import { requestContext } from './middleware/request-context.js';
import { notFound, errorHandler } from './middleware/error-handler.js';
import { createLogger } from './utils/logger.js';
import { AppError } from './utils/app-error.js';

export function createApp({ config, jobService, screenshotService, videoService, analysisService, logger = createLogger({ level: config.logLevel }) }) {
  if (!jobService) throw new TypeError('createApp requires a configured jobService');
  const app = express();
  app.set('env', config.nodeEnv);
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(requestContext(logger));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, false); // CLI/same-origin requests do not need CORS headers.
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'This origin is not allowed.'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Request-Id', 'Location'],
    credentials: false,
    maxAge: 600,
  }));
  // JSON requests and multipart image uploads have independent limits.
  app.use(express.json({ limit: config.jsonBodyLimitBytes, strict: true, inflate: false }));
  app.use(createHealthRouter());
  app.use('/api/jobs', createJobsRouter(jobService, screenshotService, videoService, analysisService));
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
