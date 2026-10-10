import type { DocumentData, JobRequest, JobStatus, Mapping, Section } from '../types';
import { categories, makeDemoDocument } from '../data';
import { cleanHtml } from '../utils/security';
import { mode, milestoneBackend } from './config';
export { mode, milestoneBackend } from './config';
const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const jobs = new Map<string, { start: number; request: JobRequest; cancelled: boolean }>();
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const timeout = AbortSignal.timeout(60000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(`${base}/api${path}`, {
    ...options,
    signal,
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.message || body.detail || '';
    } catch {
      /* Non-JSON error */
    }
    throw new Error(
      `Request failed (${response.status}). ${typeof detail === 'string' ? detail : 'Check the backend logs.'}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
function post<T>(path: string, body: unknown, signal?: AbortSignal) {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body), signal });
}
function uploadPart(
  form: FormData,
  signal: AbortSignal,
  onProgress: (n: number) => void,
): Promise<{ fileId?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/api/uploads`);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status}). Please retry.`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error('The upload endpoint returned invalid JSON.'));
      }
    };
    xhr.onerror = () => fail('Upload interrupted. Check your connection and retry.');
    xhr.ontimeout = () => fail('Upload timed out. Please retry.');
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    if (signal.aborted) {
      cleanup();
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    xhr.send(form);
  });
}
export const api = {
  async upload(file: File, onProgress: (n: number) => void, signal: AbortSignal): Promise<string> {
    if (mode === 'demo') {
      for (let n = 0; n <= 100; n += 25) {
        await wait(80, signal);
        onProgress(n);
      }
      return `demo-file-${crypto.randomUUID()}`;
    }
    const chunked = file.size > 100 * 1024 ** 2;
    const size = chunked ? 10 * 1024 ** 2 : file.size;
    const total = Math.ceil(file.size / size);
    const uploadId = crypto.randomUUID();
    let result: { fileId?: string } = {};
    for (let index = 0; index < total; index++) {
      let succeeded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const form = new FormData();
          form.append(
            'file',
            file.slice(index * size, Math.min((index + 1) * size, file.size)),
            file.name,
          );
          if (chunked) {
            form.append('uploadId', uploadId);
            form.append('chunkIndex', String(index));
            form.append('totalChunks', String(total));
            form.append('filename', file.name);
          }
          result = await uploadPart(form, signal, (n) =>
            onProgress(Math.round(((index + n) / total) * 100)),
          );
          succeeded = true;
          break;
        } catch (error) {
          if (signal.aborted || attempt === 2) throw error;
          await wait(500 * (attempt + 1), signal);
        }
      }
      if (!succeeded) throw new Error('Upload failed.');
    }
    if (!result.fileId)
      throw new Error('Upload completed without a fileId. Check the upload contract.');
    return result.fileId;
  },
  async createJob(body: JobRequest, signal?: AbortSignal): Promise<string> {
    if (mode === 'demo') {
      await wait(200, signal);
      const id = `demo-job-${crypto.randomUUID()}`;
      jobs.set(id, { start: Date.now(), request: body, cancelled: false });
      return id;
    }
    const result = await post<{ jobId: string }>('/jobs', body, signal);
    if (!result.jobId) throw new Error('The backend did not return a jobId.');
    return result.jobId;
  },
  async status(id: string, signal?: AbortSignal): Promise<JobStatus> {
    if (mode === 'live') return request(`/jobs/${encodeURIComponent(id)}`, { signal });
    const job = jobs.get(id);
    if (!job) throw new Error('Demo job expired. Start a new document.');
    const progress = Math.min(100, Math.floor((Date.now() - job.start) / 180));
    return {
      status: job.cancelled ? 'cancelled' : progress === 100 ? 'completed' : 'processing',
      stage: Math.min(4, Math.floor(progress / 20)),
      progress,
      message: [
        'Inspecting sample evidence',
        'Finding significant visual changes',
        'Ordering sample process steps',
        'Drafting sample sections and captions',
        'Checking sample evidence and review flags',
      ][Math.min(4, Math.floor(progress / 20))],
    };
  },
  async result(id: string, signal?: AbortSignal): Promise<DocumentData> {
    if (mode === 'demo') {
      const job = jobs.get(id);
      if (!job) throw new Error('Demo job expired.');
      return makeDemoDocument(job.request.category, job.request.docType);
    }
    return validateDocument(await request(`/jobs/${encodeURIComponent(id)}/result`, { signal }));
  },
  async cancel(id: string) {
    if (mode === 'demo') {
      const job = jobs.get(id);
      if (job) job.cancelled = true;
      return;
    }
    await post(`/jobs/${encodeURIComponent(id)}/cancel`, {});
  },
  async parseTemplate(
    file: File,
    category: keyof typeof categories,
    signal?: AbortSignal,
  ): Promise<Mapping[]> {
    if (milestoneBackend)
      throw new Error(
        'DOCX template parsing is not implemented in this backend. Use the editable built-in outline.',
      );
    if (mode === 'demo') {
      await wait(650, signal);
      return categories[category].sections.slice(0, 4).map((heading, i) => ({
        heading: `${i + 1}. ${heading}`,
        section: heading,
        confidence: i === 3 ? 'check' : 'auto',
      }));
    }
    const form = new FormData();
    form.append('file', file);
    const data = await request<{ sections: (string | Partial<Mapping>)[] }>('/templates/parse', {
      method: 'POST',
      body: form,
      signal,
    });
    if (!Array.isArray(data.sections) || !data.sections.length)
      throw new Error(
        'No template headings found. Use the built-in template or choose another DOCX.',
      );
    return data.sections.map((s, i) =>
      typeof s === 'string'
        ? {
            heading: s,
            section: categories[category].sections[i] || 'Unmapped',
            confidence: 'check',
          }
        : {
            heading: s.heading || `Section ${i + 1}`,
            section: s.section || 'Unmapped',
            confidence: s.confidence || 'check',
          },
    );
  },
  async regenerate(
    id: string,
    section: Section,
    category: keyof typeof categories,
    docType: string,
  ): Promise<Section> {
    if (milestoneBackend)
      throw new Error(
        'Per-section regeneration is not implemented in this backend. You can edit the text yourself.',
      );
    if (mode === 'demo') {
      await wait(750);
      const original = makeDemoDocument(category, docType).sections.find(
        (s) => s.id === section.id,
      );
      return {
        ...section,
        html: original?.html || '<p>Demo regenerated section. Review this sample before use.</p>',
        userEdited: false,
      };
    }
    const result = await post<Section>(
      `/jobs/${encodeURIComponent(id)}/sections/${encodeURIComponent(section.id)}/regenerate`,
      { section },
    );
    if (typeof result.html !== 'string')
      throw new Error('Regeneration returned an invalid section.');
    return {
      ...section,
      ...result,
      id: section.id,
      html: cleanHtml(result.html),
      userEdited: false,
    };
  },
  async export(
    id: string,
    sections: Section[],
    details?: { title: string; meta: Record<string, string> },
  ): Promise<{ docxUrl?: string; pdfUrl?: string; zipUrl?: string }> {
    if (milestoneBackend)
      throw new Error(
        'This backend does not implement Word or PDF export yet. Download your screenshots or save a JSON draft.',
      );
    if (mode === 'demo')
      throw new Error(
        'Word and PDF export need the backend. Your demo edits are saved locally; use “Save draft” to download a JSON backup.',
      );
    return post(`/jobs/${encodeURIComponent(id)}/export`, { sections, ...details });
  },
};
export function validateDocument(data: unknown): DocumentData {
  const d = data as DocumentData;
  if (
    !d ||
    !['education', 'work', 'personal'].includes(d.category) ||
    typeof d.title !== 'string' ||
    !Array.isArray(d.sections) ||
    !d.sections.length ||
    !d.validation ||
    !['steps', 'figures', 'verified', 'flagged'].every((key) =>
      Number.isFinite(d.validation[key as keyof typeof d.validation]),
    )
  )
    throw new Error('The backend returned an invalid document. Check the document JSON contract.');
  const ids = new Set<string>();
  return {
    ...d,
    missing: Array.isArray(d.missing) ? d.missing : [],
    meta: d.meta || {},
    sections: d.sections.map((s) => {
      if (!s.id || ids.has(s.id) || typeof s.heading !== 'string' || typeof s.html !== 'string')
        throw new Error('Document sections must have unique IDs, headings and HTML.');
      ids.add(s.id);
      return { ...s, html: cleanHtml(s.html), blocks: s.blocks || [], flags: s.flags || [] };
    }),
  };
}
export function stageIndex(stage: number | string, progress: number) {
  if (typeof stage === 'number') return Math.max(0, Math.min(4, stage));
  const names = ['analyse', 'extract', 'identify', 'write', 'verify'];
  const normal = stage.toLowerCase();
  const found = names.findIndex((n) => normal.startsWith(n) || normal.includes(n));
  return found >= 0 ? found : Math.max(0, Math.min(4, Math.floor(progress / 20)));
}
