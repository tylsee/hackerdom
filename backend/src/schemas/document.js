import { z } from 'zod';

export const generateDocumentSchema = z.object({
  regenerate: z.boolean().optional().default(false),
}).strict();

const evidenceSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['screenshot', 'video_frame']),
  order: z.number().int().positive(),
  timestampMs: z.number().int().min(0).nullable(),
  retrievalPath: z.string().startsWith('/api/jobs/'),
}).strict();

const stepSchema = z.object({
  sourceStepId: z.uuid(),
  number: z.number().int().positive(),
  title: z.string().min(1).max(200),
  instruction: z.string().min(1).max(4000),
  explanation: z.string().max(4000),
  expectedResult: z.string().max(2000).nullable(),
  caption: z.string().min(1).max(500),
  supportStatus: z.enum(['supported', 'needs_review', 'unsupported']),
  reviewNote: z.string().max(1000).nullable(),
  startTimestampMs: z.number().int().min(0).nullable(),
  endTimestampMs: z.number().int().min(0).nullable(),
  selectedEvidence: evidenceSchema.nullable(),
}).strict();

const sectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), heading: z.string(), paragraphs: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('procedure'), heading: z.string(), steps: z.array(stepSchema).min(1) }).strict(),
  z.object({ kind: z.literal('review'), heading: z.string(), notes: z.array(z.object({
    stepNumber: z.number().int().positive(), supportStatus: z.enum(['needs_review', 'unsupported']),
    note: z.string().min(1),
  }).strict()).min(1) }).strict(),
]);

export const documentContentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  documentType: z.enum(['sop', 'tutorial', 'user_manual', 'lab_report']),
  writingTone: z.enum(['academic', 'professional']),
  sourceInputType: z.enum(['screenshots', 'video']),
  sections: z.array(sectionSchema).min(1),
  stepCount: z.number().int().min(1).max(100),
  reviewCount: z.number().int().min(0).max(100),
}).strict();
