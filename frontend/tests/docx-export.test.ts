import { describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { buildWordDocument } from '../src/services/docx-export';
import type { DocumentData } from '../src/types';

// Valid 1×1 transparent PNG used only in unit tests.
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2n0AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const path = '/api/jobs/test-job/video/frames/evidence-1';
const draft = (): DocumentData => ({
  category: 'work', docType: 'SOP', title: 'Excel Workflow',
  meta: { status: 'Backend document', backend: 'Milestone 7' },
  sections: [{ id: 'step1', heading: '1. Enter order details',
    html: '<p><strong>Enter</strong> the order in <em>Excel</em> &amp; save.</p>' +
      '<p style="text-align:center"><u>Expected:</u> order displayed.</p>' +
      '<ol><li>Open workbook</li><li>Enter order</li></ol>',
    blocks: [{ type: 'figure', id: 'figure-1', frameId: 'evidence-1',
      caption: 'Edited screenshot caption', checkpoint: 'Order visible', annotated: false,
      fileUrl: path }],
    flags: [{ id: 'flag', level: 'needs_review', text: 'Confirm order ID.', frames: ['evidence-1'] }],
  }],
  validation: { steps: 1, figures: 1, verified: 0, flagged: 1 }, missing: [],
  frames: [{ frameId: 'evidence-1', fileUrl: path }],
});
const decode = (v: Uint8Array) => new TextDecoder().decode(v);

describe('editable Word export', () => {
  it('produces an actual OpenXML DOCX with edited instructions, numbering, captions and private embedded evidence', async () => {
    const load = vi.fn(async (_path: string) => new Blob([new Uint8Array(png)], { type: 'image/png' }));
    const file = await buildWordDocument(draft(), load);
    const zip = unzipSync(file.bytes);
    const content = decode(zip['word/document.xml']);
    const rels = decode(zip['word/_rels/document.xml.rels']);
    expect(file.filename).toBe('Excel Workflow.docx');
    expect(file.figureCount).toBe(1);
    expect(content).toContain('1. Enter order details');
    expect(content).toContain('<w:b/>');
    expect(content).toContain('<w:i/>');
    expect(content).toContain('Excel');
    expect(content).toContain('Edited screenshot caption');
    expect(content).toContain('Review required: Confirm order ID.');
    expect(content).toContain('<w:numPr>');
    expect(content).toContain('r:embed="rId3"');
    expect(rels).toContain('Target="media/evidence-1.png"');
    expect(zip['word/media/evidence-1.png']).toEqual(png);
    expect(zip['[Content_Types].xml']).toBeDefined();
    expect(zip['word/styles.xml']).toBeDefined();
    expect(zip['word/numbering.xml']).toBeDefined();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(path);
    expect(content).not.toContain('Bearer');
    expect(content).not.toContain('test-job');
  });

  it('keeps each caption while reusing a fetched image only once', async () => {
    const d = draft();
    d.sections.push({ ...d.sections[0], id: 'step2', heading: '2. Review the result',
      html: '<p>The results are <strong>ready</strong>.</p>',
      blocks: [{ ...d.sections[0].blocks[0], id: 'figure-2', caption: 'Second caption' }], flags: [] });
    const load = vi.fn(async () => new Blob([new Uint8Array(png)], { type: 'image/png' }));
    const zip = unzipSync((await buildWordDocument(d, load)).bytes);
    expect(load).toHaveBeenCalledTimes(1);
    expect(Object.keys(zip).filter((x) => x.startsWith('word/media/'))).toHaveLength(1);
    const content = decode(zip['word/document.xml']);
    expect(content).toContain('Edited screenshot caption');
    expect(content).toContain('Second caption');
    expect(content.match(/<w:drawing>/g)).toHaveLength(2);
  });

  it('escapes XML and never exports executable HTML content', async () => {
    const d = draft();
    d.title = 'Guide <Sales> & Operations';
    d.sections[0].html = '<p>Keep <b>documents</b> safe &amp; readable</p><script>alert("x")</script>';
    d.sections[0].blocks = [];
    const file = await buildWordDocument(d, async () => { throw new Error('No images should be fetched.'); });
    const content = decode(unzipSync(file.bytes)['word/document.xml']);
    expect(file.filename).toBe('Guide <Sales> & Operations.docx'.replace(/[<>]/g, '-'));
    expect(content).toContain('Guide &lt;Sales&gt; &amp; Operations');
    expect(content).not.toContain('<script>');
    expect(content).not.toContain('alert');
  });

  it('stops export rather than omitting a failed private evidence fetch', async () => {
    await expect(buildWordDocument(draft(), async () => { throw new Error('Private image unavailable'); }))
      .rejects.toThrow('Private image unavailable');
  });

  it('stops export for invalid or missing evidence images', async () => {
    await expect(buildWordDocument(draft(), async () => new Blob(['not an image'], { type: 'image/png' })))
      .rejects.toThrow(/Unsupported evidence image/);
    const d = draft();
    delete d.sections[0].blocks[0].fileUrl;
    d.frames = [];
    await expect(buildWordDocument(d, async () => new Blob())).rejects.toThrow(/Missing image URL/);
  });
});
