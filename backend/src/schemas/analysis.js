import { z } from 'zod';

// Gemini output is untrusted. Validate shape AND evidence against this job.
export const modelStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(1).max(4000),
  explanation: z.string().trim().max(4000),
  expectedResult: z.string().trim().max(2000).nullable(),
  caption: z.string().trim().min(1).max(500),
  evidenceIds: z.array(z.uuid()).max(12),
  startTimestampMs: z.number().int().min(0).nullable(),
  endTimestampMs: z.number().int().min(0).nullable(),
  supportStatus: z.enum(['supported', 'needs_review', 'unsupported']),
  reviewNote: z.string().trim().max(1000).nullable(),
}).strict();

export const modelResultSchema = z.object({
  steps: z.array(modelStepSchema).min(1).max(100),
}).strict();

// Deliberately small JSON Schema supported by the GenAI structured-output API.
// SDK/schema compliance does not replace Zod and ownership/chronology checks.
export const geminiOutputSchema = {
  type: 'object',
  properties: {
    steps: { type: 'array', maxItems: 100, items: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        instruction: { type: 'string' },
        explanation: { type: 'string' },
        expectedResult: { type: ['string', 'null'] },
        caption: { type: 'string' },
        evidenceIds: { type: 'array', items: { type: 'string' } },
        startTimestampMs: { type: ['integer', 'null'] },
        endTimestampMs: { type: ['integer', 'null'] },
        supportStatus: { type: 'string', enum: ['supported', 'needs_review', 'unsupported'] },
        reviewNote: { type: ['string', 'null'] },
      },
      required: ['title', 'instruction', 'explanation', 'expectedResult', 'caption',
        'evidenceIds', 'startTimestampMs', 'endTimestampMs', 'supportStatus', 'reviewNote'],
      additionalProperties: false,
    } },
  },
  required: ['steps'], additionalProperties: false,
};

export function validateAnalysis(output, evidence, kind, durationMs = null) {
  const result = modelResultSchema.safeParse(output);
  if (!result.success) throw new Error('INVALID_AI_RESULT');
  const allowed = new Map(evidence.map((item, index) => [item.id, { index, time: item.timestampMs ?? null }]));
  let previousEvidenceIndex = -1;
  return result.data.steps.map((step, index) => {
    const referenced = step.evidenceIds.map((id) => {
      const match = allowed.get(id);
      if (!match) throw new Error('INVALID_EVIDENCE_REFERENCE');
      return { id, ...match };
    });
    if (new Set(step.evidenceIds).size !== step.evidenceIds.length) throw new Error('DUPLICATE_EVIDENCE_REFERENCE');
    if (referenced.some((item, i) => i > 0 && item.index < referenced[i - 1].index)) {
      throw new Error('NONCHRONOLOGICAL_EVIDENCE');
    }
    if (referenced.length && referenced[0].index < previousEvidenceIndex) {
      throw new Error('NONCHRONOLOGICAL_STEPS');
    }
    if (referenced.length) previousEvidenceIndex = referenced[0].index;
    if ((step.startTimestampMs === null) !== (step.endTimestampMs === null)) {
      throw new Error('INVALID_STEP_TIMESTAMPS');
    }
    if (kind === 'screenshots' && (step.startTimestampMs !== null || step.endTimestampMs !== null)) {
      throw new Error('SCREENSHOT_TIMESTAMPS_UNAVAILABLE');
    }
    if (kind === 'video' && step.startTimestampMs !== null && (
      step.endTimestampMs < step.startTimestampMs || step.endTimestampMs > durationMs ||
      referenced.some((item) => item.time !== null &&
        (item.time < step.startTimestampMs || item.time > step.endTimestampMs))
    )) throw new Error('INVALID_STEP_TIMESTAMPS');
    // Model judgments are never independently verified claims.
    const supportStatus = step.supportStatus === 'supported' && !referenced.length
      ? 'needs_review' : step.supportStatus;
    return {
      id: cryptoRandomId(), order: index + 1, ...step, supportStatus,
      reviewNote: supportStatus !== step.supportStatus ? 'No visual evidence was cited.' : step.reviewNote,
      evidenceImageIds: kind === 'screenshots' ? step.evidenceIds : [],
      videoFrameIds: kind === 'video' ? step.evidenceIds : [],
    };
  });
}

import { randomUUID } from 'node:crypto';
const cryptoRandomId = () => randomUUID();
