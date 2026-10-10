import { describe, expect, it } from 'vitest';
import { initialWizard } from '../src/data';
import workflow from './fixtures/workflow.json';
import {
  evidenceDocument,
  evidenceIssue,
  jobPayload,
  milestone,
  type BackendStep,
} from '../src/services/milestone';
const data = () => ({
  ...initialWizard,
  settings: {},
  evidence: [
    { id: 'upload', file: new File(['video'], 'Excel.mp4', { type: 'video/mp4' }), duration: 116 },
  ],
  references: [],
  brief: 'Document an Excel table.',
  outline: ['Objective', 'Procedure'],
});
describe('friend backend adapter', () => {
  it('maps the five steps supplied by your teammate without losing evidence links', () => {
    const frames = workflow.steps
      .flatMap((s) => s.videoFrameIds)
      .map((id, i) => ({ id, order: i + 1, timestampMs: i * 1000 }));
    const result = evidenceDocument(data(), 'job', frames, workflow.steps, workflow.analysis.model);
    expect(result.sections).toHaveLength(5);
    expect(result.sections.map((s) => s.heading)).toEqual(
      workflow.steps.map((s) => `${s.order}. ${s.title}`),
    );
    expect(result.sections.flatMap((s) => s.blocks.map((b) => b.frameId))).toEqual(
      workflow.steps.flatMap((s) => s.videoFrameIds),
    );
    expect(result.sections[4].html).toContain('ORD-2003');
    expect(result.meta.aiModel).toBe('gemini-3.5-flash');
  });
  it('uses the strict backend schema, not the old upload-file IDs', () => {
    expect(jobPayload(data())).toEqual({
      preferences: { writingTone: 'academic', documentType: 'lab_report', inputType: 'video' },
      metadata: { title: 'Excel', additionalContext: 'Document an Excel table.' },
    });
    expect(
      jobPayload({ ...data(), category: 'personal', docType: 'Recipe' }).preferences.documentType,
    ).toBe('tutorial');
  });
  it('rejects mixed inputs and unsupported limits before creating a job', () => {
    expect(
      evidenceIssue({
        ...data(),
        evidence: [...data().evidence, { id: 'image', file: new File(['png'], '1.png') }],
      }),
    ).toMatch(/OR/);
    expect(
      evidenceIssue({ ...data(), evidence: [{ ...data().evidence[0], duration: 181 }] }),
    ).toMatch(/3 minutes/);
    expect(
      evidenceIssue({
        ...data(),
        evidence: Array.from({ length: 13 }, (_, i) => ({
          id: String(i),
          file: new File(['png'], `${i}.png`),
        })),
      }),
    ).toMatch(/12 screenshots/);
  });
  it('renders extracted evidence without inventing instructions or verified counts', () => {
    const result = evidenceDocument(data(), 'job', [{ id: 'frame', order: 1, timestampMs: 1981 }]);
    expect(result.validation).toEqual({ steps: 0, figures: 1, verified: 0, flagged: 1 });
    expect(result.frames![0].fileUrl).toBe('/api/jobs/job/video/frames/frame');
    expect(result.sections.find((s) => s.id === 'source-evidence')!.blocks[0].caption).toContain(
      '0:01',
    );
    expect(result.meta.status).toContain('not analysed');
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });
  it('maps real steps and linked frames while preserving unused screenshots', () => {
    const step: BackendStep = {
      id: 'step',
      order: 1,
      title: 'Create workbook',
      instruction: 'Open <Excel> & create a workbook.',
      explanation: 'A clean grid.',
      expectedResult: 'Blank workbook.',
      caption: 'Workbook creation',
      evidenceImageIds: [],
      videoFrameIds: ['a'],
      startTimestampMs: 0,
      endTimestampMs: 1981,
      supportStatus: 'supported',
      reviewNote: null,
    };
    const result = evidenceDocument(
      data(),
      'job',
      [
        { id: 'a', order: 1, timestampMs: 0 },
        { id: 'b', order: 2, timestampMs: 1981 },
      ],
      [step],
      'gemini-test',
    );
    expect(result.sections[0].html).toContain('&lt;Excel&gt; &amp;');
    expect(result.sections[0].blocks[0].frameId).toBe('a');
    expect(result.sections.at(-1)!.blocks[0].frameId).toBe('b');
    expect(result.validation.verified).toBe(0);
    expect(result.validation.steps).toBe(1);
  });
  it('does not send private tokens to foreign image URLs or other jobs', async () => {
    await expect(milestone.image('job', 'https://example.com/image.png')).rejects.toThrow(
      'Invalid private',
    );
    await expect(milestone.image('job', '/api/jobs/other/video/frames/image')).rejects.toThrow(
      'Invalid private',
    );
    await expect(
      milestone.image('job', '/api/jobs/job/video/frames/image?token=x'),
    ).rejects.toThrow('Invalid private');
  });
});
