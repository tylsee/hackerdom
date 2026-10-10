import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './utils/logger.js';
import { openDatabase, DatabaseInitializationError } from './db/database.js';
import { createJobRepository } from './models/job-repository.js';
import { createJobService } from './services/job-service.js';
import { createScreenshotRepository } from './models/screenshot-repository.js';
import { createScreenshotService } from './services/screenshot-service.js';
import { createVideoRepository } from './models/video-repository.js';
import { createVideoService } from './services/video-service.js';
import { createAnalysisRepository } from './models/analysis-repository.js';
import { createAnalysisService } from './services/analysis-service.js';
import { createGeminiAnalyzer } from './services/gemini-analyzer.js';
import { createDocumentRepository } from './models/document-repository.js';
import { createDocumentService } from './services/document-service.js';
import { createTemplateRepository } from './models/template-repository.js';
import { createTemplateService } from './services/template-service.js';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export async function startServer({ config, logger = createLogger({ level: config.logLevel }) }) {
  const db = openDatabase(config);
  let jobService;
  let screenshotService;
  let videoService;
  let analysisService;
  let documentService;
  let templateService;
  try {
    jobService = createJobService(createJobRepository(db));
    const uploadRoot = config.databasePath === ':memory:'
      ? join(tmpdir(), 'docuai-m3-test-uploads')
      : join(dirname(config.databasePath), 'uploads');
    screenshotService = createScreenshotService(createScreenshotRepository(db), { uploadRoot });
    videoService = createVideoService(createVideoRepository(db), { uploadRoot,
      ffmpegPath: config.ffmpegPath ?? 'ffmpeg', ffprobePath: config.ffprobePath ?? 'ffprobe' });
    analysisService = createAnalysisService(createAnalysisRepository(db), {
      jobService, screenshotService, videoService,
      analyzer: createGeminiAnalyzer({ apiKey: config.geminiApiKey, model: config.geminiModel,
        onSchemaFallback: () => logger.warn('gemini_schema_fallback', { mode: 'json_only' }) }),
      model: config.geminiModel, logger,
    });
    documentService = createDocumentService(createDocumentRepository(db), {
      jobService, analysisService, screenshotService, videoService,
    });
    templateService = createTemplateService(createTemplateRepository(db), { uploadRoot, jobService, documentService });
  } catch {
    db.close();
    throw new DatabaseInitializationError();
  }
  const server = createServer(createApp({ config, logger, jobService, screenshotService, videoService, analysisService, documentService, templateService }));
  server.once('close', () => {
    // Abort active video extraction before closing its shared database handle.
    void Promise.allSettled([videoService.shutdown(), analysisService.shutdown()])
      .finally(() => { if (db.open) db.close(); });
  });
  server.requestTimeout = 240000; // Bounded video uploads; reverse proxy may impose stricter limits.
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      if (db.open) db.close();
      rejectListen(error);
    };
    server.once('error', onError);
    server.listen(config.port, config.host, () => {
      server.off('error', onError);
      resolveListen();
    });
  });
  const address = server.address();
  videoService.resumePending(); // Resume queued/interrupted preprocessing after a restart.
  analysisService.resumePending(); // Resume queued/interrupted Gemini analysis.
  logger.info('server_started', { host: config.host, port: address.port });
  return server;
}

export function shutdownServer(server, { timeoutMs, logger, signal }) {
  logger.info('server_stopping', { signal });
  return new Promise((resolveShutdown) => {
    let forced = false;
    const timer = setTimeout(() => {
      forced = true;
      logger.error('shutdown_timeout', { code: 'SHUTDOWN_TIMEOUT' });
      server.closeAllConnections();
      resolveShutdown(false);
    }, timeoutMs);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (forced) return;
      if (error) logger.error('shutdown_failed', { code: 'SHUTDOWN_FAILED' });
      else logger.info('server_stopped');
      resolveShutdown(!error);
    });
    server.closeIdleConnections();
  });
}

async function main() {
  const bootstrapLogger = createLogger({ level: 'info', sink: process.stderr });
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Only ConfigurationError contains a deliberately sanitized message.
    process.stderr.write(`${error.name === 'ConfigurationError' ? error.message : 'Unable to load environment configuration.'}\n`);
    process.exitCode = 1;
    return;
  }
  const logger = createLogger({ level: config.logLevel });
  let server;
  try {
    server = await startServer({ config, logger });
  } catch (error) {
    bootstrapLogger.error('startup_failed', {
      code: error.code === 'EADDRINUSE' ? 'PORT_IN_USE'
        : error.code === 'DATABASE_INIT_FAILED' ? 'DATABASE_INIT_FAILED' : 'LISTEN_FAILED',
      host: config.host,
      port: config.port,
    });
    process.exitCode = 1;
    return;
  }
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      const clean = await shutdownServer(server, { timeoutMs: config.shutdownTimeoutMs, logger, signal });
      process.exit(clean ? 0 : 1);
    });
  }
}

// Importing this module for tests does not bind a port or register process handlers.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
