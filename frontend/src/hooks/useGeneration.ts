import { useEffect, useRef, useState } from 'react';
import { api, mode, milestoneBackend } from '../services/api';
import { milestone } from '../services/milestone';
import type { DocumentData, JobStatus, WizardData } from '../types';
import { videoExtensions, extension } from '../utils/files';
export function useGeneration() {
  const [status, setStatus] = useState<JobStatus>({
    status: 'queued',
    stage: 0,
    progress: 0,
    message: 'Preparing your files',
  });
  const [error, setError] = useState('');
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const job = useRef('');
  const lastData = useRef<WizardData | null>(null);
  const run = useRef(0);
  const polling = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      run.current++;
      controller.current?.abort();
      if (polling.current) clearTimeout(polling.current);
    },
    [],
  );
  async function start(
    data: WizardData,
    onComplete: (document: DocumentData, jobId: string) => void,
  ) {
    const token = ++run.current;
    controller.current?.abort();
    if (polling.current) clearTimeout(polling.current);
    controller.current = new AbortController();
    const signal = controller.current.signal;
    lastData.current = data;
    job.current = '';
    setError('');
    setUpload(null);
    setBusy(true);
    setStatus({ status: 'queued', stage: 0, progress: 0, message: 'Preparing your files' });
    const fail = (e: unknown) => {
      if (token !== run.current || signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Something went wrong. Please retry.');
      setBusy(false);
    };
    try {
      if (milestoneBackend) {
        const result = await milestone.run(data, signal, {
          job: (id) => {
            if (token === run.current) job.current = id;
          },
          status: (value) => {
            if (token === run.current) setStatus(value);
          },
          upload: (value) => {
            if (token === run.current) setUpload(value);
          },
        });
        if (token === run.current) {
          setBusy(false);
          onComplete(result.document, result.id);
        }
        return;
      }
      const evidence: string[] = [];
      for (const item of data.evidence) {
        setUpload({ name: item.file.name, progress: 0 });
        evidence.push(
          await api.upload(
            item.file,
            (p) => {
              if (token === run.current) setUpload({ name: item.file.name, progress: p });
            },
            signal,
          ),
        );
      }
      const references: string[] = [];
      for (const item of data.references) {
        setUpload({ name: item.file.name, progress: 0 });
        references.push(
          await api.upload(
            item.file,
            (p) => {
              if (token === run.current) setUpload({ name: item.file.name, progress: p });
            },
            signal,
          ),
        );
      }
      let templateId: string | undefined;
      if (data.templateMode === 'custom' && data.templateFile) {
        setUpload({ name: data.templateFile.name, progress: 0 });
        templateId = await api.upload(
          data.templateFile,
          (p) => setUpload({ name: data.templateFile!.name, progress: p }),
          signal,
        );
      }
      setUpload(null);
      const videoIndex = data.evidence.findIndex((i) =>
        videoExtensions.includes(extension(i.file.name)),
      );
      const id = await api.createJob({
        category: data.category,
        docType: data.docType,
        videoFileId: videoIndex >= 0 ? evidence[videoIndex] : null,
        imageFileIds: evidence.filter((_, i) => i !== videoIndex),
        briefText: data.brief,
        briefFileIds: references,
        template: {
          type: data.templateMode,
          sections:
            data.templateMode === 'custom'
              ? data.mappings.map((item) => item.heading)
              : data.outline,
          ...(templateId ? { fileId: templateId, mapping: data.mappings } : {}),
        },
        extractionSettings: {
          captureOnChange: data.settings['Capture on change'],
          dedupe: data.settings['Drop near-identical frames'],
          splitLongVideos: data.settings['Split long recordings'],
          flagSensitiveData: data.settings['Flag sensitive data'],
        },
      });
      if (token !== run.current) {
        await api.cancel(id);
        return;
      }
      job.current = id;
      const started = Date.now();
      let lastProgress = -1;
      let lastChange = started;
      const poll = async () => {
        if (token !== run.current) return;
        try {
          const next = await api.status(id, signal);
          if (token !== run.current) return;
          if (!Number.isFinite(next.progress))
            throw new Error('Invalid job progress from the backend.');
          setStatus({ ...next, progress: Math.min(100, Math.max(0, next.progress)) });
          if (next.progress !== lastProgress) {
            lastProgress = next.progress;
            lastChange = Date.now();
          }
          if (next.status === 'failed')
            throw new Error(
              next.message || 'Generation failed. Your files are still selected. Try again.',
            );
          if (next.status === 'cancelled')
            throw new Error('The backend cancelled this job. Return to the template to try again.');
          if (next.status === 'completed') {
            let result = await api.result(id, signal);
            const requestedOutline =
              data.templateMode === 'custom'
                ? data.mappings.map((item) => item.heading)
                : data.outline;
            if (mode === 'demo' && requestedOutline?.length) {
              const sample = result.sections;
              result = {
                ...result,
                sections: requestedOutline.map((heading, i) => ({
                  ...sample[i % sample.length],
                  id: sample[i]?.id || `s-outline-${i}`,
                  heading: `${i + 1}.0 ${heading}`,
                  blocks: i < sample.length ? sample[i].blocks : [],
                  flags: i < sample.length ? sample[i].flags : [],
                })),
              };
              result.validation = {
                ...result.validation,
                figures: result.sections.reduce((n, s) => n + s.blocks.length, 0),
                flagged: result.sections.reduce((n, s) => n + s.flags.length, 0),
              };
            }
            if (token === run.current) {
              setBusy(false);
              onComplete(result, id);
            }
            return;
          }
          if (Date.now() - lastChange > 180000)
            throw new Error(
              'No progress for three minutes. Your job may still be running; retry checking or cancel it.',
            );
          polling.current = setTimeout(() => void poll(), 900);
        } catch (e) {
          fail(e);
        }
      };
      void poll();
    } catch (e) {
      fail(e);
    }
  }
  async function cancel(): Promise<boolean> {
    setCancelling(true);
    setError('');
    try {
      if (job.current && !milestoneBackend) await api.cancel(job.current);
      run.current++;
      controller.current?.abort();
      if (polling.current) clearTimeout(polling.current);
      setBusy(false);
      setUpload(null);
      return true;
    } catch (e) {
      setError(`Cancellation could not be confirmed. ${e instanceof Error ? e.message : ''}`);
      return false;
    } finally {
      setCancelling(false);
    }
  }
  async function recheck(onComplete: (document: DocumentData, id: string) => void) {
    if (!job.current) return;
    setError('');
    setBusy(true);
    try {
      if (milestoneBackend && lastData.current) {
        controller.current?.abort();
        controller.current = new AbortController();
        const token = ++run.current;
        const result = await milestone.run(
          lastData.current,
          controller.current.signal,
          {
            job: () => {},
            status: (value) => {
              if (token === run.current) setStatus(value);
            },
            upload: (value) => {
              if (token === run.current) setUpload(value);
            },
          },
          job.current,
        );
        if (token === run.current) onComplete(result.document, result.id);
        return;
      }
      const next = await api.status(job.current);
      setStatus(next);
      if (next.status === 'completed') onComplete(await api.result(job.current), job.current);
      else setError(`Job status: ${next.status}. ${next.message}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check job.');
    } finally {
      setBusy(false);
    }
  }
  return { status, error, upload, busy, cancelling, start, cancel, recheck };
}
