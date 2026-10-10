import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeDemoDocument } from '../src/data';
import { api, validateDocument, stageIndex } from '../src/services/api';
import { validateFile } from '../src/utils/files';
import { cleanHtml, safeUrl } from '../src/utils/security';
import { draftKey, readDraft } from '../src/hooks/useAutosave';
describe('document and evidence contracts', () => {
  it.each(['education', 'work', 'personal'] as const)(
    'renders distinct valid %s sample documents',
    (category) => {
      const d = validateDocument(makeDemoDocument(category, 'Example'));
      expect(d.category).toBe(category);
      expect(d.sections.length).toBeGreaterThan(4);
      expect(d.sections.flatMap((s) => s.blocks)).toHaveLength(d.validation.figures);
      expect(d.sections.flatMap((s) => s.flags)).toHaveLength(d.validation.flagged);
    },
  );
  it('rejects invalid or duplicate section IDs', () => {
    expect(() => validateDocument({})).toThrow();
    const d = makeDemoDocument('work', 'SOP');
    d.sections[1].id = d.sections[0].id;
    expect(() => validateDocument(d)).toThrow(/unique/);
  });
  it('removes executable HTML and unsafe links', () => {
    expect(cleanHtml('<script>alert(1)</script><p onclick="alert(1)">Safe</p>')).toBe(
      '<p>Safe</p>',
    );
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('/assets/demo-evidence.svg')).toContain('/assets/demo-evidence.svg');
  });
  it('accepts supported types, rejects empty and wrong files', () => {
    expect(validateFile(new File(['a'], 'demo.MP4'), ['mp4'])).toBeNull();
    expect(validateFile(new File([], 'empty.mp4'), ['mp4'])).toContain('empty');
    expect(validateFile(new File(['x'], 'x.exe'), ['mp4'])).toContain('choose');
  });
  it('restores only valid drafts from the current mode', () => {
    localStorage.clear();
    localStorage.setItem(draftKey, 'invalid');
    expect(readDraft()).toBeNull();
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        document: makeDemoDocument('education', 'Lab report'),
        jobId: 'demo-1',
        mode: 'demo',
      }),
    );
    expect(readDraft()?.document.category).toBe('education');
  });
  it('normalises stages and bounds', () => {
    expect(stageIndex('extracting', 30)).toBe(1);
    expect(stageIndex('verify', 90)).toBe(4);
    expect(stageIndex(20, 100)).toBe(4);
  });
});
describe('demo lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  it('advances to completion and supports genuine cancellation', async () => {
    vi.useFakeTimers();
    const request = {
      category: 'work' as const,
      docType: 'SOP',
      videoFileId: null,
      imageFileIds: ['demo'],
      briefText: '',
      briefFileIds: [],
      template: { type: 'builtin' as const },
    };
    const creating = api.createJob(request);
    await vi.advanceTimersByTimeAsync(200);
    const id = await creating;
    expect((await api.status(id)).status).toBe('processing');
    await vi.advanceTimersByTimeAsync(19000);
    expect((await api.status(id)).status).toBe('completed');
    expect((await api.result(id)).category).toBe('work');
    await api.cancel(id);
    expect((await api.status(id)).status).toBe('cancelled');
  });
  it('blocks aborting uploads and reports backend-only exports honestly', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      api.upload(new File(['x'], 'x.png'), () => {}, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(api.export('demo', [])).rejects.toThrow(/backend/);
  });
});
