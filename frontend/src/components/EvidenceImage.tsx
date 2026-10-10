import { useEffect, useState } from 'react';
import { milestone } from '../services/milestone';
export function EvidenceImage({
  jobId,
  path,
  caption,
}: {
  jobId: string;
  path: string;
  caption: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setError('');
    milestone
      .image(jobId, path, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Image unavailable.');
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [jobId, path]);
  return (
    <div className="private-evidence-image">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${caption}`}>
          <img src={url} alt={caption} />
        </a>
      ) : (
        <div className="figure-placeholder" role="status">
          {error || 'Loading your screenshot…'}
        </div>
      )}
    </div>
  );
}
