import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/app-error.js';
import { documentContentSchema } from '../schemas/document.js';

const labels = Object.freeze({
  sop: { title: 'SOP', overview: 'Purpose', audience: 'Intended Audience', objectives: 'Objectives', procedure: 'Procedure' },
  tutorial: { title: 'Tutorial', overview: 'Overview', audience: 'Intended Audience', objectives: 'Learning Objectives', procedure: 'Steps' },
  user_manual: { title: 'User Manual', overview: 'Overview', audience: 'Intended Audience', objectives: 'Objectives', procedure: 'Instructions' },
  lab_report: { title: 'Lab Report', overview: 'Aim', audience: 'Intended Audience', objectives: 'Objectives', procedure: 'Method' },
});

function publicDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    revision: row.revision,
    status: 'ready',
    analysisCompletedAt: row.analysis_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...JSON.parse(row.content_json),
  };
}

function prepareContent(job, steps, screenshotService, videoService) {
  const { documentType, writingTone, inputType } = job.preferences;
  const headings = labels[documentType];
  const metadata = job.metadata;
  const video = inputType === 'video' ? videoService?.list(job.id) : null;
  const evidenceItems = inputType === 'screenshots'
    ? (screenshotService?.list(job.id) ?? []) : (video?.frames ?? []);
  const evidenceMap = new Map(evidenceItems.map((item) => [item.id, item]));

  const formattedSteps = steps.map((step) => {
    const ids = inputType === 'screenshots' ? step.evidenceImageIds : step.videoFrameIds;
    // The last cited frame usually depicts the completed action; this is a
    // deterministic selection, not an invented visual-quality assessment.
    const selectedId = ids.at(-1);
    if (ids.some((id) => !evidenceMap.has(id))) {
      throw new AppError(409, 'DOCUMENT_EVIDENCE_MISSING', 'Evidence referenced by the analysis is unavailable.');
    }
    const item = selectedId ? evidenceMap.get(selectedId) : null;
    const retrievalPath = item ? inputType === 'screenshots'
      ? `/api/jobs/${job.id}/screenshots/${item.id}`
      : `/api/jobs/${job.id}/video/frames/${item.id}` : null;
    return {
      sourceStepId: step.id,
      number: step.stepNumber,
      title: step.title, instruction: step.instruction, explanation: step.explanation,
      expectedResult: step.expectedResult, caption: step.caption,
      supportStatus: step.supportStatus, reviewNote: step.reviewNote,
      startTimestampMs: step.startTimestampMs, endTimestampMs: step.endTimestampMs,
      selectedEvidence: item ? {
        id: item.id, kind: inputType === 'screenshots' ? 'screenshot' : 'video_frame',
        order: item.order, timestampMs: inputType === 'video' ? item.timestampMs : null,
        retrievalPath,
      } : null,
    };
  });

  const sections = [];
  const text = (heading, values) => {
    const paragraphs = values.filter((value) => typeof value === 'string' && value.trim().length)
      .map((value) => value.trim());
    if (paragraphs.length) sections.push({ kind: 'text', heading, paragraphs });
  };
  // Only use user-provided metadata. No invented prerequisites, observations,
  // tool requirements, claims of success, or procedural content.
  text(headings.overview, [metadata.processDescription]);
  text(headings.audience, [metadata.intendedAudience]);
  text(headings.objectives, metadata.objectives);
  text('Additional Context', [metadata.additionalContext]);
  text('Special Requirements', [metadata.specialRequirements]);
  sections.push({ kind: 'procedure', heading: headings.procedure, steps: formattedSteps });
  const reviewNotes = formattedSteps.filter((step) => step.supportStatus !== 'supported')
    .map((step) => ({ stepNumber: step.number, supportStatus: step.supportStatus,
      note: step.reviewNote || 'Check this step against the original evidence before publishing.' }));
  if (reviewNotes.length) sections.push({ kind: 'review', heading: 'Evidence Review', notes: reviewNotes });

  return documentContentSchema.parse({
    title: metadata.title?.trim() || `Untitled ${headings.title}`,
    documentType, writingTone, sourceInputType: inputType,
    sections, stepCount: formattedSteps.length, reviewCount: reviewNotes.length,
  });
}

export function createDocumentService(repository, { jobService, analysisService, screenshotService, videoService }) {
  return Object.freeze({
    generate(jobId, token, { regenerate = false } = {}) {
      const job = jobService.get(jobId, token);
      // Any existing draft must be explicitly regenerated. Don't silently erase
      // future user edits or change a document merely because metadata changed.
      if (repository.findByJob(job.id) && !regenerate) {
        throw new AppError(409, 'DOCUMENT_ALREADY_EXISTS', 'The document already exists. Use regenerate to replace it.');
      }
      const analysis = analysisService.steps(jobId, token);
      if (analysis.analysis?.status !== 'ready' || !analysis.steps.length) {
        throw new AppError(409, 'ANALYSIS_NOT_READY', 'Complete AI analysis before generating a document.');
      }
      const content = prepareContent(job, analysis.steps, screenshotService, videoService);
      const timestamp = new Date().toISOString();
      try {
        return publicDocument(repository.save({
          id: randomUUID(), jobId: job.id, content,
          analysisCompletedAt: analysis.analysis.completedAt,
          timestamp, regenerate,
        }));
      } catch (error) {
        if (error.message === 'DOCUMENT_ALREADY_EXISTS') {
          throw new AppError(409, 'DOCUMENT_ALREADY_EXISTS', 'The document already exists.');
        }
        throw error;
      }
    },
    get(jobId, token) {
      const job = jobService.get(jobId, token);
      const row = repository.findByJob(job.id);
      if (!row) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Generate the document first.');
      return publicDocument(row);
    },
  });
}
