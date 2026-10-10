import { z } from 'zod';

const text = (limit) => z.string().trim().min(1).max(limit).nullable();
const metadataFields = {
  title: text(200),
  processDescription: text(4000),
  intendedAudience: text(500),
  objectives: z.array(z.string().trim().min(1).max(500)).max(20),
  additionalContext: text(8000),
  specialRequirements: text(4000),
};
const preferenceFields = {
  writingTone: z.enum(['academic', 'professional']),
  documentType: z.enum(['sop', 'user_manual', 'tutorial', 'lab_report']),
  inputType: z.enum(['screenshots', 'video']),
};
const nonEmpty = (value) => Object.keys(value).length > 0;

export const createJobSchema = z.object({
  preferences: z.object({
    writingTone: preferenceFields.writingTone,
    documentType: preferenceFields.documentType,
    // Backward-compatible default for jobs created before video uploads existed.
    inputType: preferenceFields.inputType.default('screenshots'),
  }).strict(),
  metadata: z.object({
    title: metadataFields.title.optional().default(null),
    processDescription: metadataFields.processDescription.optional().default(null),
    intendedAudience: metadataFields.intendedAudience.optional().default(null),
    objectives: metadataFields.objectives.optional().default([]),
    additionalContext: metadataFields.additionalContext.optional().default(null),
    specialRequirements: metadataFields.specialRequirements.optional().default(null),
  }).strict().prefault({}),
}).strict();

export const updateJobSchema = z.object({
  preferences: z.object(preferenceFields).partial().strict().refine(nonEmpty).optional(),
  metadata: z.object(metadataFields).partial().strict().refine(nonEmpty).optional(),
}).strict().refine((value) => value.preferences !== undefined || value.metadata !== undefined);

export const jobIdSchema = z.uuid().transform((id) => id.toLowerCase());
export const accessTokenPattern = /^[A-Za-z0-9_-]{43}$/;
