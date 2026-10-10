import { Check, LoaderCircle, Sparkles, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { stages } from '../data';
import { mode, stageIndex, milestoneBackend } from '../services/api';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { JobStatus } from '../types';
interface Props {
  status: JobStatus;
  upload: { name: string; progress: number } | null;
  error: string;
  busy: boolean;
  cancelling: boolean;
  cancel: () => void;
  retry: () => void;
  recheck: () => void;
}
export function Processing({
  status,
  upload,
  error,
  busy,
  cancelling,
  cancel,
  retry,
  recheck,
}: Props) {
  const reduced = useReducedMotion();
  const [videoFailed, setVideoFailed] = useState(false);
  const stage = stageIndex(status.stage, status.progress);
  return (
    <main className="processing page-enter">
      <div className="processing-background" aria-hidden="true">
        {!reduced && !videoFailed && (
          <video
            data-testid="processing-video"
            src="/assets/scene.mp4"
            poster="/assets/processing-poster.svg"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onError={() => setVideoFailed(true)}
          />
        )}
      </div>
      <section className="progress-area">
        <span className="eyebrow">
          {mode === 'demo'
            ? 'DEMO GENERATION · SIMULATED PROGRESS'
            : milestoneBackend
              ? 'LIVE BACKEND · DOCUMENT GENERATION'
              : 'DOCUMENT GENERATION · LIVE PROGRESS'}
        </span>
        <div className="progress-heading">
          <div>
            <h1>
              {error
                ? 'Let’s get you back on track.'
                : upload
                  ? 'Preparing your evidence.'
                  : milestoneBackend
                    ? 'Generating your document.'
                    : 'Generating your document.'}
            </h1>
            <p aria-live="polite">
              {upload
                ? `${mode === 'demo' ? 'Simulating upload' : 'Uploading'}: ${upload.name}`
                : status.message}
            </p>
          </div>
          <div className="percentage">
            <strong>
              {Math.round(upload ? upload.progress : status.progress)}
              <span>%</span>
            </strong>
            <small>
              {upload
                ? 'uploaded'
                : milestoneBackend && status.progress < 100
                  ? 'workflow stage'
                  : 'complete'}
            </small>
          </div>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label={upload ? 'File upload progress' : 'Document generation progress'}
          aria-valuenow={upload ? upload.progress : status.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${upload ? upload.progress : status.progress}%` }} />
        </div>
        <ol className="processing-stages">
          {(milestoneBackend
            ? [
                'Creating private job',
                'Extracting screenshots',
                'Gemini workflow analysis',
                'Composing the SOP document',
                'Matching template and evidence',
              ]
            : stages
          ).map((name, i) => {
            const completed = !upload && i < stage;
            const active = !upload && i === stage;
            return (
              <li key={name} className={completed ? 'completed' : active ? 'active' : 'pending'}>
                <span className="stage-icon">
                  {completed ? (
                    <Check size={16} />
                  ) : active && !error ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </span>
                <div>
                  <strong>{name}</strong>
                  <small>
                    {completed
                      ? 'Completed'
                      : active
                        ? error
                          ? 'Needs attention'
                          : 'In progress'
                        : 'Pending'}
                  </small>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {error ? (
        <section className="processing-error" role="alert">
          <AlertTriangle size={26} />
          <h2>We couldn’t finish this step.</h2>
          <p>{error}</p>
          <div className="button-row">
            <button className="primary" disabled={busy} onClick={retry}>
              {milestoneBackend ? 'Retry analysis on this job' : 'Retry generation'}
            </button>
            {mode === 'live' && (
              <button className="secondary" disabled={busy} onClick={recheck}>
                Check existing job
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="processing-message">
          <span className="ambient-mark">
            <Sparkles size={30} strokeWidth={1.4} />
          </span>
          <h2>
            Turning your process
            <br />
            into clarity.
          </h2>
          <p>
            {
              [
                'The details you captured are the starting point.',
                'Only the moments that matter belong in the document.',
                'Clear steps make knowledge easier to share.',
                'Your voice. A little more structure.',
                'Anything uncertain is surfaced for your review.',
              ][stage]
            }
          </p>
          <span className="processing-trust">
            <Check size={15} /> You’ll be able to edit every section.
          </span>
        </section>
      )}
      <div className="processing-bottom">
        <span>
          {mode === 'demo'
            ? 'Sample content only · Your files are not analysed'
            : milestoneBackend
              ? 'Stop waiting leaves the backend job running. Retry reuses its uploaded evidence.'
              : 'You stay in control of the final document'}
        </span>
        <button className="secondary" onClick={cancel} disabled={cancelling}>
          {cancelling ? 'Stopping…' : milestoneBackend ? 'Stop waiting' : 'Cancel generation'}
        </button>
      </div>
    </main>
  );
}
