import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialWizard } from '../src/data';
import { isTransientGeminiFailure, milestone } from '../src/services/milestone';

const jobId = '591d1b91-2ff8-4d3b-a0a4-8114238ea7fb';
const frameId = 'bf5cedd6-fffa-41bf-a085-9b4fee617765';
const stepId = '3afc8d15-4e44-4ef2-9976-94104bd4cbd9';
const data = () => ({
  ...initialWizard,
  category: 'work' as const,
  docType: 'SOP',
  evidence: [], // A restored browser draft has no original File objects.
  settings: { ...initialWizard.settings, 'Analyse with Gemini': true },
  references: [],
});

function mockBackend(failureCode: string) {
  sessionStorage.setItem('docuai-private-jobs-v1', JSON.stringify({ [jobId]: 'test-bearer-token' }));
  let analysisPosts = 0;
  let analysisPolls = 0;
  const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    const path = new URL(url, 'http://127.0.0.1:5173').pathname;
    const method = options.method || 'GET';
    paths.push(`${method} ${path}`);
    if ((options.headers as Record<string, string>)?.Authorization !== 'Bearer test-bearer-token')
      throw new Error('Missing bearer token');
    let body: unknown;
    if (path === `/api/jobs/${jobId}`) {
      body = { job: { preferences: { inputType: 'video' } } };
    } else if (path === `/api/jobs/${jobId}/video`) {
      body = { video: { processingStatus: 'ready', errorCode: null,
        frames: [{ id: frameId, order: 1, timestampMs: 0 }] } };
    } else if (path === `/api/jobs/${jobId}/analyze`) {
      analysisPosts++;
      body = { analysis: { status: 'processing', errorCode: null, model: 'gemini-3.5-flash' } };
    } else if (path === `/api/jobs/${jobId}/analysis`) {
      analysisPolls++;
      // A first attempt in the current run fails. The transient variant
      // then succeeds after re-enqueueing without a new job or file upload.
      const status = analysisPolls >= 3 && failureCode === 'GEMINI_HTTP_503'
        ? 'ready' : 'failed';
      body = { analysis: { status, errorCode: status === 'failed' ? failureCode : null,
        model: 'gemini-3.5-flash' } };
    } else if (path === `/api/jobs/${jobId}/steps`) {
      body = { steps: [{ id: stepId, order: 1, title: 'Create workbook',
        instruction: 'Open Excel.', explanation: 'Start a new document.',
        expectedResult: 'Blank workbook is visible.', caption: 'Excel workbook displayed.',
        evidenceImageIds: [], videoFrameIds: [frameId],
        startTimestampMs: 0, endTimestampMs: 0, supportStatus: 'supported', reviewNote: null }] };
    } else if (path === `/api/jobs/${jobId}/document`) {
      body = { document: { id: 'document-id', jobId, revision: 1,
        status: 'ready', title: 'Excel Workflow', documentType: 'sop',
        writingTone: 'professional', stepCount: 1, reviewCount: 0,
        sections: [{ kind: 'procedure', heading: 'Procedure', steps: [{
          sourceStepId: stepId, number: 1, title: 'Create workbook',
          instruction: 'Open Excel.', explanation: 'Start a new document.',
          expectedResult: 'Blank workbook is visible.', caption: 'Excel workbook displayed.',
          supportStatus: 'supported', reviewNote: null, startTimestampMs: 0,
          endTimestampMs: 0, selectedEvidence: { id: frameId, kind: 'video_frame',
            timestampMs: 0, retrievalPath: `/api/jobs/${jobId}/video/frames/${frameId}` },
        }] }] } };
    } else if (path === `/api/jobs/${jobId}/document/layout`) {
      body = { layout: { template: { source: 'default', filename: null,
        styles: { title: 'Title', heading1: 'Heading1', heading2: 'Heading2', body: 'Normal' } },
        sections: [], unmatchedTemplateHeadings: [], note: '' } };
    } else throw new Error(`Unexpected endpoint: ${path}`);
    return new Response(JSON.stringify(body), { status: 200,
      headers: { 'Content-Type': 'application/json' } });
  }));
  return { paths, getPosts: () => analysisPosts };
}

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('Gemini recovery without repeated uploads', () => {
  it('only retries transient Gemini 502, 503 and 504 errors', () => {
    expect(isTransientGeminiFailure('GEMINI_HTTP_502')).toBe(true);
    expect(isTransientGeminiFailure('GEMINI_HTTP_503')).toBe(true);
    expect(isTransientGeminiFailure('GEMINI_HTTP_504')).toBe(true);
    expect(isTransientGeminiFailure('GEMINI_HTTP_400')).toBe(false);
    expect(isTransientGeminiFailure('GEMINI_HTTP_429')).toBe(false);
    expect(isTransientGeminiFailure(null)).toBe(false);
  });
  it('retries a failed provider request and generates evidence-linked instructions in the same job', async () => {
    const { paths, getPosts } = mockBackend('GEMINI_HTTP_503');
    const result = await milestone.run(data(), new AbortController().signal,
      { job: () => {}, status: () => {}, upload: () => {} }, jobId);
    expect(getPosts()).toBe(2);
    expect(paths).not.toContain('POST /api/jobs');
    expect(paths.some((s) => s.includes('/screenshots') || (s.startsWith('POST') && s.includes('/video')))).toBe(false);
    expect(result.document.validation.steps).toBe(1);
    expect(result.document.sections[0].html).toContain('Open Excel.');
    expect(result.document.sections[0].blocks[0].caption).toBe('Excel workbook displayed.');
    expect(result.document.sections[0].blocks[0].fileUrl)
      .toBe(`/api/jobs/${jobId}/video/frames/${frameId}`);
  }, 12000);
  it('does not mark missing instructions as a finished document after an invalid API request', async () => {
    const { paths, getPosts } = mockBackend('GEMINI_HTTP_400');
    await expect(milestone.run(data(), new AbortController().signal,
      { job: () => {}, status: () => {}, upload: () => {} }, jobId))
      .rejects.toThrow(/HTTP 400/);
    expect(getPosts()).toBe(1);
    expect(paths).not.toContain(`POST /api/jobs/${jobId}/document`);
    expect(paths).not.toContain('POST /api/jobs');
  }, 7000);
});
