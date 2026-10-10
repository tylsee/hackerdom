import type { DocumentData, JobStatus, WizardData, TemplateLayoutPreview } from '../types';
import { apiBase } from './config';
import { extension, videoExtensions } from '../utils/files';
import { zipSync } from 'fflate';

export interface EvidenceFrame {
  id: string;
  order: number;
  timestampMs?: number;
  width?: number;
  height?: number;
}
export interface BackendStep {
  id: string;
  order: number;
  title: string;
  instruction: string;
  explanation: string;
  expectedResult: string;
  caption: string;
  evidenceImageIds: string[];
  videoFrameIds: string[];
  startTimestampMs: number | null;
  endTimestampMs: number | null;
  supportStatus: string;
  reviewNote: string | null;
}
interface VideoResult {
  processingStatus: string;
  errorCode: string | null;
  frames: EvidenceFrame[];
}
interface Analysis {
  status: string;
  errorCode: string | null;
  model: string;
}
const credentialsKey = 'docuai-private-jobs-v1';
const tokens = new Map<string, string>();
function remember(id: string, token: string) {
  tokens.set(id, token);
  try {
    const entries = JSON.parse(sessionStorage.getItem(credentialsKey) || '{}');
    sessionStorage.setItem(credentialsKey, JSON.stringify({ ...entries, [id]: token }));
  } catch {
    /* Session can still operate without storage. */
  }
}
function auth(id: string) {
  let token = tokens.get(id);
  if (!token) {
    try {
      token = JSON.parse(sessionStorage.getItem(credentialsKey) || '{}')[id];
    } catch {
      /* Missing access. */
    }
  }
  if (!token)
    throw new Error(
      'This browser session no longer has access to the private images. Upload the recording again.',
    );
  return { Authorization: `Bearer ${token}` };
}
async function response(path: string, options: RequestInit = {}, id?: string) {
  let result: Response;
  try {
    result = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: 'omit',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(240000)])
        : AbortSignal.timeout(60000),
      headers: { ...(id ? auth(id) : {}), ...options.headers },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('Cannot reach the backend. Start it on port 3000, then retry.');
  }
  if (!result.ok) {
    let message = `Backend request failed (${result.status}).`;
    let code = '';
    try {
      const body = await result.json();
      message = body.error?.message || message;
      code = body.error?.code || '';
    } catch {
      /* Non-JSON response. */
    }
    const error = new Error(message) as Error & { status: number; code: string };
    error.status = result.status;
    error.code = code;
    throw error;
  }
  return result;
}
async function json<T>(path: string, options: RequestInit = {}, id?: string): Promise<T> {
  return (await response(path, options, id)).json();
}
function post<T>(path: string, body: unknown, signal?: AbortSignal, id?: string) {
  return json<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
    id,
  );
}
function pause(signal: AbortSignal, milliseconds = 900) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
// Transport/service failures can be temporary. Never retry invalid schemas,
// authentication, missing evidence or other permanent errors automatically.
export function isTransientGeminiFailure(code: string | null): boolean {
  return code === 'GEMINI_HTTP_502' || code === 'GEMINI_HTTP_503' || code === 'GEMINI_HTTP_504';
}
function geminiFailureMessage(code: string | null): string {
  if (isTransientGeminiFailure(code))
    return `Gemini is temporarily unavailable (${code}). Your uploaded evidence is saved. Retry AI analysis using this job.`;
  if (code === 'GEMINI_HTTP_429')
    return 'Gemini reached an API quota or rate limit (HTTP 429). Check your Google AI quota and retry later using this job.';
  if (code === 'GEMINI_HTTP_400')
    return 'Gemini rejected the analysis request (HTTP 400). Check the model compatibility settings.';
  return `Gemini analysis failed (${code || 'unknown error'}). Your uploaded evidence is saved; you can retry analysis without uploading again.`;
}
export function evidenceIssue(data: WizardData): string {
  const videos = data.evidence.filter((i) => videoExtensions.includes(extension(i.file.name)));
  const images = data.evidence.filter((i) => !videoExtensions.includes(extension(i.file.name)));
  if (videos.length && images.length)
    return 'Choose a recording OR screenshots. This backend cannot combine both in one job.';
  if (videos.some((i) => !['mp4', 'mov', 'webm'].includes(extension(i.file.name))))
    return 'This backend accepts MP4, MOV and WebM recordings.';
  if (videos.some((i) => i.file.size > 80 * 1024 ** 2))
    return 'The backend accepts recordings up to 80 MiB.';
  if (videos.some((i) => (i.duration || 0) > 180))
    return 'The backend accepts recordings up to 3 minutes.';
  if (images.length > 12) return 'The backend accepts up to 12 screenshots per job.';
  if (images.some((i) => i.file.size > 5 * 1024 ** 2))
    return 'Each screenshot must be 5 MiB or smaller.';
  if (images.some((i) => !['png', 'jpg', 'jpeg', 'webp'].includes(extension(i.file.name))))
    return 'Screenshots must be PNG, JPEG or WebP.';
  return '';
}
export function jobPayload(data: WizardData, context = data.brief) {
  const documentType =
    (
      {
        'Lab report': 'lab_report',
        Tutorial: 'tutorial',
        Assignment: 'lab_report',
        SOP: 'sop',
        'Training manual': 'user_manual',
        'Process guide': 'sop',
        Recipe: 'tutorial',
        'How-to guide': 'tutorial',
        'Care guide': 'user_manual',
      } as Record<string, string>
    )[data.docType] || 'tutorial';
  return {
    preferences: {
      writingTone: data.category === 'education' ? 'academic' : 'professional',
      documentType,
      inputType: data.evidence.some((i) => videoExtensions.includes(extension(i.file.name)))
        ? 'video'
        : 'screenshots',
    },
    metadata: {
      title:
        data.evidence[0]?.file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled process',
      processDescription: data.brief.trim() || null,
      additionalContext: context.slice(data.brief.length).trim() || null,
    },
  };
}
export const escaped = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
function timestamp(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
}
const imagePath = (id: string, frame: string, video: boolean) =>
  `/api/jobs/${encodeURIComponent(id)}/${video ? 'video/frames' : 'screenshots'}/${encodeURIComponent(frame)}`;

export function evidenceDocument(
  data: WizardData,
  id: string,
  frames: EvidenceFrame[],
  steps: BackendStep[] = [],
  model?: string,
  analysisIssue?: string,
  isVideo?: boolean,
): DocumentData {
  const video = isVideo ?? data.evidence.some((i) => videoExtensions.includes(extension(i.file.name)));
  const figures = (items: EvidenceFrame[], prefix: string, caption?: string) =>
    items.map((f, i) => ({
      type: 'figure' as const,
      id: `${prefix}-figure-${f.id}`,
      frameId: f.id,
      caption: caption
        ? `${caption}${items.length > 1 ? ` (${i + 1}/${items.length})` : ''}`
        : `${video ? 'Video frame' : 'Screenshot'} ${f.order}${f.timestampMs !== undefined ? ` · ${timestamp(f.timestampMs)}` : ''}`,
      checkpoint: null,
      annotated: false,
      fileUrl: imagePath(id, f.id, video),
    }));
  const sections = steps.length
    ? steps.map((s) => ({
        id: s.id,
        heading: `${s.order}. ${s.title}`,
        html: `<p>${escaped(s.instruction)}</p><p>${escaped(s.explanation)}</p><p><strong>Expected result:</strong> ${escaped(s.expectedResult)}</p>${s.startTimestampMs !== null ? `<p>Video: ${timestamp(s.startTimestampMs)}–${timestamp(s.endTimestampMs ?? s.startTimestampMs)}</p>` : ''}`,
        blocks: figures(
          frames.filter((f) => [...s.videoFrameIds, ...s.evidenceImageIds].includes(f.id)),
          s.id,
          s.caption,
        ),
        flags:
          s.supportStatus !== 'supported' || s.reviewNote
            ? [
                {
                  id: `review-${s.id}`,
                  level: s.supportStatus,
                  text:
                    s.reviewNote || 'Review this AI-generated step against the source evidence.',
                  frames: [...s.videoFrameIds, ...s.evidenceImageIds],
                },
              ]
            : [],
      }))
    : (data.outline || ['Notes']).map((heading, i) => ({
        id: `notes-${i}`,
        heading,
        html: '<p>Add your observations here.</p>',
        blocks: [] as ReturnType<typeof figures>,
        flags: [] as DocumentData['sections'][number]['flags'],
      }));
  const linked = new Set(sections.flatMap((s) => s.blocks.map((b) => b.frameId)));
  const remaining = frames.filter((f) => !linked.has(f.id));
  if (remaining.length) {
    const sourceSection = {
      id: 'source-evidence',
      heading: 'Source screenshots',
      html: '<p>Chronological evidence from your upload. Sampled frames do not establish procedural steps by themselves.</p>',
      blocks: figures(remaining, 'source'),
      flags: [] as DocumentData['sections'][number]['flags'],
    };
    if (steps.length) sections.push(sourceSection);
    else sections.unshift(sourceSection);
  }
  if (!steps.length)
    sections[0].flags.push({
      id: 'review-source',
      level: 'Review evidence',
      text:
        analysisIssue ||
        'Screenshots extracted successfully. AI analysis is off; add your own instructions after reviewing the images.',
      frames: frames.slice(0, 2).map((f) => f.id),
    });
  return {
    category: data.category,
    docType: data.docType,
    title: jobPayload(data).metadata.title,
    meta: {
      status: steps.length
        ? 'AI workflow draft · review required'
        : 'Extracted evidence · not analysed',
      backend: 'Milestone 7',
      ...(model ? { aiModel: model } : {}),
    },
    sections,
    validation: {
      steps: steps.length,
      figures: sections.reduce((n, s) => n + s.blocks.length, 0),
      verified: 0,
      flagged: sections.reduce((n, s) => n + s.flags.length, 0),
    },
    missing: [
      'Gemini analysis was not completed. Document composition requires AI analysis. Independent auditing is not yet available.',
    ],
    frames: frames.map((f) => ({
      frameId: f.id,
      timestamp: f.timestampMs === undefined ? undefined : f.timestampMs / 1000,
      fileUrl: imagePath(id, f.id, video),
    })),
  };
}
export interface BackendDocument {
  id: string;
  jobId: string;
  revision: number;
  status: 'ready';
  title: string;
  documentType: string;
  writingTone: string;
  sections: Array<
    | { kind: 'text'; heading: string; paragraphs: string[] }
    | { kind: 'procedure'; heading: string; steps: Array<{
      sourceStepId: string; number: number; title: string; instruction: string;
      explanation: string; expectedResult: string | null; caption: string;
      supportStatus: string; reviewNote: string | null;
      startTimestampMs: number | null; endTimestampMs: number | null;
      selectedEvidence: { id: string; kind: string; retrievalPath: string; timestampMs: number | null } | null;
    }> }
    | { kind: 'review'; heading: string; notes: Array<{ stepNumber: number; supportStatus: string; note: string }> }
  >;
  stepCount: number;
  reviewCount: number;
}
interface BackendLayout {
  template: { source: 'default' | 'uploaded'; filename: string | null; styles: TemplateLayoutPreview['styles'] };
  sections: Array<{ heading: string; templateHeading: string; templateMatched: boolean; headingStyleId: string }>;
  unmatchedTemplateHeadings: string[];
  note: string;
}
// Build the editor from the authoritative Milestone 6 document and Milestone 7 layout.
// Text is escaped and evidence references remain authenticated paths, not public URLs.
export function composedDocument(
  data: WizardData, id: string, frames: EvidenceFrame[], content: BackendDocument,
  layout: BackendLayout, isVideo?: boolean,
): DocumentData {
  const ordered = [...frames].sort((a, b) => a.order - b.order);
  const frameIds = new Set(ordered.map((item) => item.id));
  const video = isVideo ?? data.evidence.some((i) => videoExtensions.includes(extension(i.file.name)));
  const sections: DocumentData['sections'] = [];
  for (const block of content.sections) {
    if (block.kind === 'text') {
      sections.push({ id: `doc-text-${sections.length}`, heading: block.heading,
        html: block.paragraphs.map((text) => `<p>${escaped(text)}</p>`).join(''), blocks: [], flags: [] });
    } else if (block.kind === 'procedure') {
      for (const step of block.steps) {
        const selected = step.selectedEvidence;
        if (selected && !frameIds.has(selected.id))
          throw new Error('The generated document cites an image outside this job.');
        const image = selected ? [{
          type: 'figure' as const, id: `doc-figure-${step.sourceStepId}`,
          frameId: selected.id, caption: step.caption, checkpoint: null, annotated: false,
          fileUrl: imagePath(id, selected.id, video),
        }] : [];
        sections.push({ id: step.sourceStepId, heading: `${step.number}. ${step.title}`,
          html: `<p>${escaped(step.instruction)}</p>` +
            (step.explanation ? `<p>${escaped(step.explanation)}</p>` : '') +
            (step.expectedResult ? `<p><strong>Expected result:</strong> ${escaped(step.expectedResult)}</p>` : '') +
            (step.startTimestampMs !== null ? `<p>Video: ${timestamp(step.startTimestampMs)}–${timestamp(step.endTimestampMs ?? step.startTimestampMs)}</p>` : ''),
          blocks: image,
          flags: step.supportStatus !== 'supported' || step.reviewNote ? [{
            id: `review-${step.sourceStepId}`, level: step.supportStatus,
            text: step.reviewNote || 'Review this AI-generated step against its evidence.',
            frames: selected ? [selected.id] : [],
          }] : [],
        });
      }
    } else if (block.kind === 'review') {
      // Review flags are attached to their actual steps above; no extra fabricated prose.
    }
  }
  if (!sections.length) throw new Error('The backend returned an empty document.');
  return {
    category: data.category, docType: data.docType, title: content.title,
    meta: { status: 'Backend document · review before publication',
      backend: 'Milestone 7', revision: String(content.revision),
      template: layout.template.filename || 'Default' },
    sections,
    validation: { steps: content.stepCount,
      figures: sections.reduce((n, s) => n + s.blocks.length, 0),
      verified: 0,
      flagged: sections.reduce((n, s) => n + s.flags.length, 0) },
    missing: ['PDF export, independent evidence auditing and persistent server-side rich-text edits are not available yet. Save your edits as JSON or download Word.'],
    templateLayout: { source: layout.template.source, filename: layout.template.filename,
      styles: layout.template.styles,
      sections: layout.sections.map(({ heading, templateHeading, templateMatched, headingStyleId }) =>
        ({ heading, templateHeading, templateMatched, headingStyleId })),
      unmatchedHeadings: layout.unmatchedTemplateHeadings, note: layout.note },
    frames: ordered.map((f) => ({ frameId: f.id,
      timestamp: f.timestampMs === undefined ? undefined : f.timestampMs / 1000,
      fileUrl: imagePath(id, f.id, video) })),
  };
}
export interface MilestoneCallbacks {
  job: (id: string) => void;
  status: (s: JobStatus) => void;
  upload: (value: { name: string; progress: number } | null) => void;
}
export const milestone = {
  async run(
    data: WizardData,
    signal: AbortSignal,
    events: MilestoneCallbacks,
    existing?: string,
  ): Promise<{ document: DocumentData; id: string }> {
    const issue = existing ? '' : evidenceIssue(data);
    if (issue || (!existing && !data.evidence.length))
      throw new Error(issue || 'Add evidence first.');
    let context = data.brief;
    for (const ref of data.references) {
      if (extension(ref.file.name) !== 'txt')
        throw new Error(
          'This backend supports text context only. Paste the reference text into the brief or use a TXT file.',
        );
      context += `\n\n${ref.file.name}:\n${await ref.file.text()}`;
    }
    if (data.brief.trim().length > 4000)
      throw new Error('Keep your process description within 4,000 characters.');
    if (context.length > 8000)
      throw new Error('Keep the brief and TXT references within 8,000 characters in total.');
    let id = existing || '';
    if (!id) {
      events.status({
        status: 'processing',
        stage: 0,
        progress: 0,
        message: 'Creating your private evidence job',
      });
      const created = await post<{ job: { id: string }; accessToken: string }>(
        '/api/jobs',
        jobPayload(data, context),
        signal,
      );
      if (!created.job?.id || !created.accessToken)
        throw new Error('The backend returned an invalid private job.');
      id = created.job.id;
      remember(id, created.accessToken);
      events.job(id);
      if (data.templateMode === 'custom' && data.templateFile) {
        events.status({ status: 'processing', stage: 0, progress: 10,
          message: 'Validating and storing your private DOCX template' });
        const templateForm = new FormData();
        templateForm.append('template', data.templateFile, data.templateFile.name);
        events.upload({ name: data.templateFile.name, progress: 0 });
        await this.upload(id, 'template', templateForm, signal, (n) =>
          events.upload({ name: data.templateFile!.name, progress: n }));
        events.upload(null);
      }
      const video = data.evidence.find((i) => videoExtensions.includes(extension(i.file.name)));
      const form = new FormData();
      if (video) {
        const mime = (
          { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } as Record<string, string>
        )[extension(video.file.name)];
        form.append('video', new Blob([video.file], { type: mime }), video.file.name);
      } else
        for (const i of data.evidence) {
          const mime =
            extension(i.file.name) === 'webp'
              ? 'image/webp'
              : extension(i.file.name) === 'png'
                ? 'image/png'
                : 'image/jpeg';
          form.append('screenshots', new Blob([i.file], { type: mime }), i.file.name);
        }
      events.upload({
        name: video?.file.name || `${data.evidence.length} screenshots`,
        progress: 0,
      });
      await this.upload(id, video ? 'video' : 'screenshots', form, signal, (n) =>
        events.upload({
          name: video?.file.name || `${data.evidence.length} screenshots`,
          progress: n,
        }),
      );
      events.upload(null);
    } else events.job(id);
    // Resuming an existing job must not depend on browser File objects,
    // which disappear when the tab reloads. The backend owns the input type.
    const videoInput = existing
      ? (await json<{ job: { preferences: { inputType: string } } }>(
          `/api/jobs/${id}`, { signal }, id)).job.preferences.inputType === 'video'
      : data.evidence.some((i) => videoExtensions.includes(extension(i.file.name)));
    let frames: EvidenceFrame[];
    if (videoInput) {
      const started = Date.now();
      while (true) {
        const { video } = await json<{ video: VideoResult | null }>(
          `/api/jobs/${id}/video`,
          { signal },
          id,
        );
        if (!video) throw new Error('No recording was received. Retry the upload.');
        if (video.processingStatus === 'failed')
          throw new Error(
            `Frame extraction failed (${video.errorCode || 'unknown'}). Check FFmpeg and ffprobe on the backend.`,
          );
        if (video.processingStatus === 'ready') {
          frames = video.frames;
          break;
        }
        if (Date.now() - started > 180000)
          throw new Error(
            'Extraction is taking longer than expected. Check the existing job or retry later.',
          );
        events.status({
          status: 'processing',
          stage: 1,
          progress: 25,
          message: `${video.processingStatus === 'queued' ? 'Waiting for the video worker' : 'FFmpeg is extracting screenshots'} · waiting for the backend (no percentage available)`,
        });
        await pause(signal);
      }
    } else
      frames = (
        await json<{ screenshots: EvidenceFrame[] }>(`/api/jobs/${id}/screenshots`, { signal }, id)
      ).screenshots;
    if (!frames.length) throw new Error('The backend returned no usable screenshots.');
    let steps: BackendStep[] = [];
    let model: string | undefined;
    if (data.settings['Analyse with Gemini']) {
        let analysis = (
          await json<{ analysis: Analysis | null }>(`/api/jobs/${id}/analysis`, { signal }, id)
        ).analysis;
        if (!analysis || analysis.status === 'failed')
          analysis = (await post<{ analysis: Analysis }>(`/api/jobs/${id}/analyze`, {}, signal, id))
            .analysis;
        const started = Date.now();
        let transientRetries = 0;
        while (analysis.status !== 'ready') {
          if (analysis.status === 'failed') {
            if (isTransientGeminiFailure(analysis.errorCode) && transientRetries < 2) {
              transientRetries += 1;
              events.status({ status: 'processing', stage: 2, progress: 65,
                message: `Gemini service temporarily unavailable. Retrying analysis (${transientRetries}/2) without re-uploading…` });
              await pause(signal, transientRetries * 3000);
              analysis = (await post<{ analysis: Analysis }>(
                `/api/jobs/${id}/analyze`, {}, signal, id)).analysis;
              continue;
            }
            throw new Error(geminiFailureMessage(analysis.errorCode));
          }
          if (Date.now() - started > 300000)
            throw new Error('Gemini analysis timed out. Your evidence is saved. Retry analysis using the existing job.');
          events.status({
            status: 'processing',
            stage: 2,
            progress: 65,
            message:
              'Gemini is analysing evidence · waiting for the backend (no percentage available)',
          });
          await pause(signal);
          analysis = (
            await json<{ analysis: Analysis }>(`/api/jobs/${id}/analysis`, { signal }, id)
          ).analysis;
        }
        const result = await json<{ steps: BackendStep[] }>(
          `/api/jobs/${id}/steps`,
          { signal },
          id,
        );
        steps = result.steps;
        model = analysis.model;
        if (!steps.length)
          throw new Error('Gemini returned no procedural steps. Your evidence is saved. Retry analysis using this job.');
    }
    let document: DocumentData;
    if (steps.length) {
      events.status({ status: 'processing', stage: 3, progress: 85,
        message: 'Generating and saving the structured document in SQLite' });
      let result: { document: BackendDocument };
      try {
        result = await post<{ document: BackendDocument }>(
          `/api/jobs/${id}/document`, {}, signal, id);
      } catch (error) {
        if ((error as { code?: string })?.code !== 'DOCUMENT_ALREADY_EXISTS') throw error;
        // Rechecking a job must never overwrite its already persisted draft.
        result = await json<{ document: BackendDocument }>(
          `/api/jobs/${id}/document`, { signal }, id);
      }
      events.status({ status: 'processing', stage: 4, progress: 95,
        message: 'Matching document sections to Word template styles' });
      const mapped = await json<{ layout: BackendLayout }>(
        `/api/jobs/${id}/document/layout`, { signal }, id);
      document = composedDocument(data, id, frames, result.document, mapped.layout, videoInput);
      if (model) document.meta.aiModel = model;
    } else {
      document = evidenceDocument(data, id, frames, steps, model, undefined, videoInput);
      if (data.templateMode === 'custom')
        document.missing.push('The uploaded DOCX template is stored, but layout mapping requires a generated document.');
    }
    events.status({ status: 'completed', stage: 4, progress: 100,
      message: steps.length ? `${steps.length} document steps prepared` : `${frames.length} screenshots ready for review` });
    return { id, document };
  },
  async upload(
    id: string,
    kind: string,
    form: FormData,
    signal: AbortSignal,
    onProgress: (n: number) => void,
  ) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${apiBase}/api/jobs/${id}/${kind}`);
      xhr.timeout = 240000;
      xhr.setRequestHeader('Authorization', auth(id).Authorization);
      const cleanup = () => signal.removeEventListener('abort', abort);
      const abort = () => xhr.abort();
      signal.addEventListener('abort', abort, { once: true });
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let message = `Upload failed (${xhr.status}).`;
        try {
          message = JSON.parse(xhr.responseText).error?.message || message;
        } catch {}
        reject(new Error(message));
      };
      xhr.onerror = () => {
        cleanup();
        reject(new Error('Cannot upload to the backend. Start it on port 3000 and retry.'));
      };
      xhr.ontimeout = () => {
        cleanup();
        reject(new Error('Video upload timed out. Retry the upload.'));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new DOMException('Stopped', 'AbortError'));
      };
      if (signal.aborted) {
        cleanup();
        reject(new DOMException('Stopped', 'AbortError'));
        return;
      }
      xhr.send(form);
    });
  },
  async image(id: string, path: string, signal?: AbortSignal) {
    // Never send a private token to an arbitrary URL from a restored draft.
    const expected = `/api/jobs/${encodeURIComponent(id)}/`;
    if (
      !path.startsWith(expected) ||
      !/^\/api\/jobs\/[^/]+\/(video\/frames|screenshots)\/[^/?#]+$/.test(path)
    )
      throw new Error('Invalid private image path.');
    return (await response(path, { signal }, id)).blob();
  },
  async download(id: string, frames: NonNullable<DocumentData['frames']>) {
    const files: Record<string, Uint8Array> = {};
    for (const [i, f] of frames.entries())
      files[
        `screenshot-${String(i + 1).padStart(2, '0')}${f.timestamp !== undefined ? `-${Math.round(f.timestamp * 1000)}ms` : ''}.png`
      ] = new Uint8Array(await (await this.image(id, f.fileUrl)).arrayBuffer());
    const zipped = zipSync(files, { level: 0 });
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(zipped)], { type: 'application/zip' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'docuai-screenshots.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
