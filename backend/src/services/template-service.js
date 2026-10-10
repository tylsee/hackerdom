import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../utils/app-error.js';
import { defaultTemplateProfile, inspectDocxTemplate } from './docx-template-parser.js';

// Template extraction is limited to a presentation plan. The authored DOCX
// is never silently rewritten and the original document draft stays immutable.
function matchSection(heading, candidates) {
  const norm = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const synonyms = {
    purpose: ['purpose', 'overview', 'aim', 'introduction'],
    'intended audience': ['intended audience', 'audience', 'target audience'],
    objectives: ['objectives', 'learning objectives', 'goals'],
    'learning objectives': ['learning objectives', 'objectives', 'goals'],
    procedure: ['procedure', 'method', 'steps', 'instructions', 'methodology'],
    steps: ['steps', 'procedure', 'instructions', 'method'],
    instructions: ['instructions', 'procedure', 'steps', 'method'],
    method: ['method', 'procedure', 'methodology', 'steps'],
    aim: ['aim', 'purpose', 'overview'],
    overview: ['overview', 'purpose', 'introduction'],
    'additional context': ['additional context', 'context'],
    'special requirements': ['special requirements', 'requirements'],
    'evidence review': ['evidence review', 'review', 'verification'],
  };
  const target = norm(heading);
  const accepted = [target, ...(synonyms[target] ?? [])].map(norm);
  return candidates.find((h) => accepted.includes(norm(h.heading))) ?? null;
}

export function buildDocumentLayout(document, profile) {
  const mapped = document.sections.map((section) => {
    const matched = profile.source === 'uploaded' ? matchSection(section.heading, profile.templateHeadings) : null;
    return { ...section, templateHeading: matched?.heading ?? section.heading,
      headingStyleId: matched?.styleId ?? profile.styles.heading1,
      templateMatched: Boolean(matched),
      ...(section.kind === 'procedure' ? { stepStyleId: profile.styles.heading2 } : {}) };
  });
  return { documentId: document.id, jobId: document.jobId, documentRevision: document.revision,
    title: document.title, titleStyleId: profile.styles.title, bodyStyleId: profile.styles.body,
    template: profile, sections: mapped,
    unmatchedTemplateHeadings: profile.templateHeadings.filter((h) =>
      !mapped.some((s) => s.templateMatched && s.templateHeading === h.heading)).map((h) => h.heading),
    note: 'Presentation plan only. The original DOCX is retained for later export; layout fidelity is not yet guaranteed.' };
}

export function createTemplateService(repository, { uploadRoot, jobService, documentService }) {
  mkdirSync(uploadRoot, { recursive: true, mode: 0o700 });
  const filePath = (jobId, templateId) => join(uploadRoot, jobId, 'templates', `${templateId}.docx`);
  const profile = (row) => row ? { id: row.id, ...JSON.parse(row.profile_json),
    uploadedAt: row.created_at, updatedAt: row.updated_at } : defaultTemplateProfile();
  const check = (jobId, token) => jobService.get(jobId, token);
  return Object.freeze({
    get(jobId, token) {
      const job = check(jobId, token);
      return profile(repository.get(job.id));
    },
    async upload(jobId, token, file) {
      const job = check(jobId, token);
      if (!file) throw new AppError(400, 'MISSING_TEMPLATE', 'Upload a DOCX file as the template field.');
      const parsed = inspectDocxTemplate(file.buffer, file.originalname);
      const id = randomUUID(), dir = join(uploadRoot, job.id, 'templates');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') await chmod(dir, 0o700);
      const path = filePath(job.id, id);
      await writeFile(path, file.buffer, { flag: 'wx', mode: 0o600 });
      const now = new Date().toISOString();
      try {
        const previous = repository.save({ id, jobId: job.id, filename: parsed.filename,
          byteSize: parsed.byteSize, sha256: parsed.sha256, profileJson: JSON.stringify(parsed),
          createdAt: now, updatedAt: now });
        if (previous) await rm(filePath(job.id, previous.id), { force: true }).catch(() => {});
        return this.get(jobId, token);
      } catch (error) {
        await rm(path, { force: true }).catch(() => {});
        throw error;
      }
    },
    async download(jobId, token) {
      const job = check(jobId, token);
      const row = repository.get(job.id);
      if (!row) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'No custom template is uploaded.');
      let bytes;
      try { bytes = await readFile(filePath(job.id, row.id)); }
      catch { throw new AppError(503, 'TEMPLATE_UNAVAILABLE', 'The template file is unavailable.'); }
      return { bytes, filename: row.filename };
    },
    async remove(jobId, token) {
      const job = check(jobId, token);
      const existing = repository.get(job.id);
      if (!existing) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'No custom template is uploaded.');
      repository.delete(job.id);
      await rm(filePath(job.id, existing.id), { force: true }).catch(() => {});
      return defaultTemplateProfile();
    },
    layout(jobId, token) {
      const doc = documentService.get(jobId, token);
      return buildDocumentLayout(doc, profile(repository.get(doc.jobId)));
    },
    async purgeJob(jobId) {
      await rm(join(uploadRoot, jobId, 'templates'), { recursive: true, force: true });
    },
  });
}
