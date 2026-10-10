import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialWizard } from '../src/data';
import { composedDocument, jobPayload, milestone } from '../src/services/milestone';
import type { WizardData } from '../src/types';

const draftInput = (): WizardData => ({
  ...initialWizard,
  category: 'work', docType: 'SOP',
  brief: 'Record customer orders in Excel.',
  evidence: [{ id: 'upload-1', file: new File(['png test'], 'workflow.png', { type: 'image/png' }) }],
  settings: { 'Analyse with Gemini': true },
});
const jobId = '591d1b91-2ff8-4d3b-a0a4-8114238ea7fb';
const evidenceId = 'bf5cedd6-fffa-41bf-a085-9b4fee617765';
const stepId = '3afc8d15-4e44-4ef2-9976-94104bd4cbd9';
const apiDocument = {
  id: 'bb282771-6db9-45fc-9d84-dcd4b7e68ab1', jobId,
  revision: 1, status: 'ready' as const, title: 'Excel Workflow', documentType: 'sop',
  writingTone: 'professional', stepCount: 1, reviewCount: 0,
  sections: [
    { kind: 'text' as const, heading: 'Purpose', paragraphs: ['Record customer orders in Excel.'] },
    { kind: 'procedure' as const, heading: 'Procedure', steps: [{
      sourceStepId: stepId, number: 1, title: 'Create workbook',
      instruction: 'Open a blank Excel workbook.', explanation: 'Prepare the table.',
      expectedResult: 'A new spreadsheet opens.', caption: 'New workbook displayed.',
      supportStatus: 'supported', reviewNote: null, startTimestampMs: null, endTimestampMs: null,
      selectedEvidence: { id: evidenceId, kind: 'screenshot', retrievalPath: `/api/jobs/${jobId}/screenshots/${evidenceId}`, timestampMs: null },
    }] },
  ],
};
const layout = {
  template: { source: 'uploaded' as const, filename: 'custom.docx',
    styles: { title: 'Title', heading1: 'Heading1', heading2: 'Heading2', body: 'Normal' } },
  sections: [
    { heading: 'Purpose', templateHeading: 'Purpose', templateMatched: true, headingStyleId: 'Heading1' },
    { heading: 'Procedure', templateHeading: 'Procedure', templateMatched: true, headingStyleId: 'Heading1' },
  ],
  unmatchedTemplateHeadings: ['Appendix'],
  note: 'Presentation plan only; exact layout fidelity is not yet guaranteed.',
};

describe('Milestone 7 frontend/backend integration', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('maps authoritative SOP sections and private selected evidence, not synthetic instructions', () => {
    const result = composedDocument(draftInput(), jobId,
      [{ id: evidenceId, order: 1 }], apiDocument, layout);
    expect(result.title).toBe('Excel Workflow');
    expect(result.sections.map((section) => section.heading)).toEqual(['Purpose', '1. Create workbook']);
    expect(result.sections[0].html).toContain('Record customer orders');
    expect(result.sections[1].html).toContain('Open a blank Excel workbook.');
    expect(result.sections[1].blocks[0].fileUrl).toBe(`/api/jobs/${jobId}/screenshots/${evidenceId}`);
    expect(result.templateLayout?.unmatchedHeadings).toEqual(['Appendix']);
    expect(result.validation).toEqual({ steps: 1, figures: 1, verified: 0, flagged: 0 });
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });
  it('refuses to render a cross-job or nonexistent evidence frame', () => {
    expect(() => composedDocument(draftInput(), jobId, [], apiDocument, layout))
      .toThrow(/image outside this job/);
  });
  it('sends exact v7 job metadata field names', () => {
    expect(jobPayload(draftInput())).toEqual({
      preferences: { writingTone: 'professional', documentType: 'sop', inputType: 'screenshots' },
      metadata: { title: 'workflow', processDescription: 'Record customer orders in Excel.', additionalContext: null },
    });
  });
  it('creates a job, uploads template+evidence with bearer token, analyses, composes and maps', async () => {
    const data = draftInput();
    data.templateMode = 'custom';
    data.templateFile = new File(['custom word doc placeholder'], 'custom.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const xhrCalls: { path: string; token: string }[] = [];
    class FakeXHR {
      status = 201;
      timeout = 0;
      upload = { onprogress: null as null | ((e: ProgressEvent) => void) };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      private path = '';
      private token = '';
      open(_method: string, path: string) { this.path = path; }
      setRequestHeader(name: string, value: string) { if (name === 'Authorization') this.token = value; }
      send(_body: FormData) {
        xhrCalls.push({ path: this.path, token: this.token });
        queueMicrotask(() => this.onload?.());
      }
      abort() { this.onabort?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const calls: { path: string; method: string; auth?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, 'http://127.0.0.1:5173').pathname;
      calls.push({ path, method: init.method || 'GET',
        auth: (init.headers as Record<string, string> | undefined)?.Authorization });
      let body: unknown;
      if (path === '/api/jobs') body = { job: { id: jobId }, accessToken: 'private-test-token' };
      else if (path.endsWith('/screenshots')) body = { screenshots: [{ id: evidenceId, order: 1 }] };
      else if (path.endsWith('/analysis')) body = { analysis: { status: 'ready', errorCode: null, model: 'gemini-3.5-flash' } };
      else if (path.endsWith('/steps')) body = { steps: [{ id: stepId, order: 1, title: 'Create workbook',
        instruction: 'Open a blank Excel workbook.', explanation: 'Prepare the table.',
        expectedResult: 'A new spreadsheet opens.', caption: 'New workbook displayed.',
        evidenceImageIds: [evidenceId], videoFrameIds: [], startTimestampMs: null,
        endTimestampMs: null, supportStatus: 'supported', reviewNote: null }] };
      else if (path.endsWith('/document/layout')) body = { layout };
      else if (path.endsWith('/document')) body = { document: apiDocument };
      else throw new Error(`Unexpected mock path ${path}`);
      return new Response(JSON.stringify(body), { status: 200,
        headers: { 'Content-Type': 'application/json' } });
    }));
    const signal = new AbortController().signal;
    const result = await milestone.run(data, signal, { job: () => {}, status: () => {}, upload: () => {} });
    expect(result.id).toBe(jobId);
    expect(result.document.sections).toHaveLength(2);
    expect(result.document.templateLayout?.source).toBe('uploaded');
    expect(xhrCalls.map((call) => call.path)).toEqual([
      `/api/jobs/${jobId}/template`, `/api/jobs/${jobId}/screenshots`,
    ]);
    expect(xhrCalls.every((call) => call.token === 'Bearer private-test-token')).toBe(true);
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/document'))).toBe(true);
    expect(calls.some((call) => call.path.endsWith('/document/layout'))).toBe(true);
    expect(calls.filter((call) => call.path !== '/api/jobs')
      .every((call) => call.auth === 'Bearer private-test-token')).toBe(true);
  });
});
