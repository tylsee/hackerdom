import { AppError } from '../utils/app-error.js';
import { validateAnalysis } from '../schemas/analysis.js';

// Read-only, stable API representation. Never expose local filenames, secrets,
// raw Gemini responses, or internal exception messages.
const publicAnalysis = (row, count) => row ? ({
  status: row.status,
  model: row.model,
  errorCode: row.error_code,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
  stepCount: row.status === 'ready' ? count : 0,
}) : null;
const publicStep = (row, kind) => {
  const ids = JSON.parse(row.evidence_ids_json);
  return {
    id: row.id, stepNumber: row.position, order: row.position,
    title: row.title, instruction: row.instruction, explanation: row.explanation,
    expectedResult: row.expected_result, caption: row.caption,
    evidenceImageIds: kind === 'screenshots' ? ids : [],
    videoFrameIds: kind === 'video' ? ids : [],
    startTimestampMs: row.start_timestamp_ms, endTimestampMs: row.end_timestamp_ms,
    supportStatus: row.support_status, reviewNote: row.review_note,
  };
};

function sampleEvenly(items, maximum) {
  if (items.length <= maximum) return items;
  const positions = new Set([0, items.length - 1]);
  for (let i = 1; i < maximum - 1; i++) positions.add(Math.round(i * (items.length - 1) / (maximum - 1)));
  return [...positions].sort((a, b) => a - b).map((index) => items[index]);
}

export function createAnalysisService(repository, { jobService, screenshotService, videoService,
  analyzer = null, model = 'gemini-2.5-flash', logger = null }) {
  const queue = [];
  let worker = null;
  let stopping = false;
  const enqueued = new Set();

  function evidenceFor(job) {
    if (job.preferences.inputType === 'screenshots') {
      const screenshots = screenshotService?.list(job.id) ?? [];
      if (!screenshots.length) throw new AppError(409, 'MISSING_EVIDENCE', 'Upload screenshots before starting analysis.');
      return { kind: 'screenshots', items: screenshots.map((s) => ({ ...s, timestampMs: null })), durationMs: null };
    }
    const video = videoService?.list(job.id);
    if (!video) throw new AppError(409, 'MISSING_EVIDENCE', 'Upload a recording before starting analysis.');
    if (video.processingStatus !== 'ready') {
      throw new AppError(409, 'VIDEO_NOT_READY', 'Wait for video frame processing to complete.');
    }
    if (!video.frames.length) throw new AppError(409, 'MISSING_VIDEO_FRAMES', 'The video has no usable frames.');
    return { kind: 'video', items: sampleEvenly(video.frames, 24), durationMs: video.durationMs };
  }

  async function process(jobId) {
    if (!repository.markProcessing(jobId)) return;
    try {
      const job = jobService.getInternalJobForAnalysis(jobId);
      const { kind, items, durationMs } = evidenceFor(job);
      const evidence = [];
      for (const item of items) {
        const data = kind === 'screenshots'
          ? await screenshotService.getFile(jobId, item.id)
          : await videoService.getFrame(jobId, item.id);
        evidence.push({ id: item.id, order: item.order, timestampMs: item.timestampMs ?? null, data });
      }
      const raw = await analyzer.analyze({ job, evidence });
      // Never trust provider-generated references; validate against ONLY the
      // frames actually sent to the model, their order, and the video duration.
      const steps = validateAnalysis(raw, evidence, kind, durationMs);
      if (!stopping) repository.complete(jobId, steps);
    } catch (error) {
      if (stopping) return; // Pending jobs are recovered on next startup.
      const known = new Set(['INVALID_AI_RESULT','INVALID_AI_JSON','EMPTY_AI_RESULT',
        'ANALYSIS_INPUT_TOO_LARGE','INVALID_EVIDENCE_REFERENCE','DUPLICATE_EVIDENCE_REFERENCE',
        'NONCHRONOLOGICAL_EVIDENCE','NONCHRONOLOGICAL_STEPS','INVALID_STEP_TIMESTAMPS',
        'SCREENSHOT_TIMESTAMPS_UNAVAILABLE']);
      // Gemini's SDK throws ApiError with a numeric HTTP status. Preserve only
      // the safe status category (never the provider message, request, or key),
      // so users can distinguish invalid requests, missing models and quotas.
      const providerStatus = error?.name === 'ApiError'
        ? Number(error.status ?? error.statusCode) : NaN;
      const code = known.has(error?.message) ? error.message
        : Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599
          ? `GEMINI_HTTP_${providerStatus}` : 'GEMINI_ANALYSIS_FAILED';
      repository.fail(jobId, code);
      logger?.warn('analysis_failed', { code });
    }
  }

  function schedule(id) {
    if (stopping || enqueued.has(id)) return;
    enqueued.add(id);
    queue.push(id);
    if (worker) return;
    // Promise microtask executes outside the initiating HTTP handler.
    worker = (async () => {
      while (queue.length && !stopping) {
        const next = queue.shift();
        try { await process(next); }
        finally { enqueued.delete(next); }
      }
    })().finally(() => { worker = null; });
  }

  return Object.freeze({
    start(jobId, token) {
      const job = jobService.get(jobId, token);
      if (!analyzer) throw new AppError(503, 'GEMINI_NOT_CONFIGURED', 'Gemini API key is not configured.');
      evidenceFor(job); // Do not enqueue an empty or unprocessed video job.
      try { repository.enqueue(job.id, model); }
      catch (error) {
        if (error.message === 'ANALYSIS_ALREADY_READY') {
          throw new AppError(409, 'ANALYSIS_ALREADY_READY', 'The job already has completed analysis.');
        }
        if (error.message === 'JOB_NOT_ANALYZABLE') {
          throw new AppError(409, 'JOB_NOT_ANALYZABLE', 'Job cannot start analysis in its current state.');
        }
        throw error;
      }
      schedule(job.id);
      return publicAnalysis(repository.findByJob(job.id), 0);
    },
    get(jobId, token) {
      const job = jobService.get(jobId, token);
      const row = repository.findByJob(job.id);
      return publicAnalysis(row, row?.status === 'ready' ? repository.listSteps(job.id).length : 0);
    },
    steps(jobId, token) {
      const job = jobService.get(jobId, token);
      const analysis = repository.findByJob(job.id);
      return {
        analysis: publicAnalysis(analysis, analysis?.status === 'ready' ? repository.listSteps(job.id).length : 0),
        steps: analysis?.status === 'ready' ? repository.listSteps(job.id).map((row) =>
          publicStep(row, job.preferences.inputType)) : [],
      };
    },
    resumePending() { if (analyzer) for (const id of repository.pending()) schedule(id); },
    async shutdown() {
      stopping = true;
      queue.length = 0;
      if (worker) await worker;
    },
  });
}
