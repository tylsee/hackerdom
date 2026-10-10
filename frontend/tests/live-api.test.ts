import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { makeDemoDocument } from '../src/data';
describe('live API adapter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_MODE', 'live');
    vi.stubEnv('VITE_BACKEND_PROFILE', 'document');
    vi.stubEnv('VITE_API_BASE_URL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('sends the contracted job fields and reads a jobId', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ jobId: 'server-job' })));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('../src/services/api');
    const body = {
      category: 'education' as const,
      docType: 'Lab report',
      videoFileId: 'video-1',
      imageFileIds: ['image-1'],
      briefText: 'Include results.',
      briefFileIds: [],
      template: { type: 'builtin' as const },
    };
    expect(await api.createJob(body)).toBe('server-job');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/jobs',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(body),
      }),
    );
  });
  it('supports HTTP 204 cancellation responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const { api } = await import('../src/services/api');
    await expect(api.cancel('job/id')).resolves.toBeUndefined();
  });
  it('reports backend errors and rejects invalid result contracts', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ sections: [] })));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('../src/services/api');
    await expect(api.status('job')).rejects.toThrow('Service unavailable');
    await expect(api.result('job')).rejects.toThrow('invalid document');
  });
  it('exports current sections with optional cover fields', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ pdfUrl: '/output.pdf' })));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('../src/services/api');
    const doc = makeDemoDocument('work', 'SOP');
    doc.sections[0].html = '<p>User edits</p>';
    await api.export('job', doc.sections, { title: 'Updated title', meta: { version: '2' } });
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.sections[0].html).toContain('User edits');
    expect(payload.title).toBe('Updated title');
  });
  it('parses real heading strings into an editable mapping', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ sections: ['Purpose', 'Procedure'] }))),
    );
    const { api } = await import('../src/services/api');
    const parsed = await api.parseTemplate(new File(['docx'], 'template.docx'), 'work');
    expect(parsed.map((s) => s.heading)).toEqual(['Purpose', 'Procedure']);
    expect(parsed.every((s) => s.confidence === 'check')).toBe(true);
  });
  it('transports large files in ordered chunks with a stable uploadId and final fileId', async () => {
    const sent: FormData[] = [];
    class XHR {
      upload = {
        onprogress: null as
          ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
      };
      status = 200;
      responseText = '';
      withCredentials = false;
      timeout = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort() {
        this.onabort?.();
      }
      send(form: FormData) {
        sent.push(form);
        this.responseText = JSON.stringify(
          Number(form.get('chunkIndex')) === 10 ? { fileId: 'large-video' } : {},
        );
        queueMicrotask(() => {
          this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
          this.onload?.();
        });
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
    const { api } = await import('../src/services/api');
    const file = {
      name: 'large.mp4',
      size: 101 * 1024 ** 2,
      slice: vi.fn(() => new Blob(['chunk'])),
    } as unknown as File;
    const progress = vi.fn();
    expect(await api.upload(file, progress, new AbortController().signal)).toBe('large-video');
    expect(sent).toHaveLength(11);
    expect(new Set(sent.map((f) => f.get('uploadId'))).size).toBe(1);
    expect(sent.map((f) => f.get('chunkIndex'))).toEqual(
      Array.from({ length: 11 }, (_, i) => String(i)),
    );
    expect(progress).toHaveBeenLastCalledWith(100);
  });
});
