import { useId, useRef, useState } from 'react';
import { Upload, FileText, Trash2, Film, Image, LoaderCircle } from 'lucide-react';
import type { UploadItem } from '../types';
import { milestoneBackend } from '../services/config';
import {
  extension,
  formatDuration,
  formatSize,
  getVideoMetadata,
  validateFile,
  videoExtensions,
} from '../utils/files';
interface Props {
  title: string;
  description: string;
  allowed: string[];
  items: UploadItem[];
  onChange: (items: UploadItem[]) => void;
  single?: boolean;
  compact?: boolean;
}
export function UploadZone({
  title,
  description,
  allowed,
  items,
  onChange,
  single = false,
  compact = false,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  async function add(files: File[]) {
    const issues: string[] = [];
    const accepted: UploadItem[] = [];
    setReading(true);
    for (const file of files) {
      const error = validateFile(file, allowed);
      if (error) {
        issues.push(error);
        continue;
      }
      if (
        !single &&
        [...items, ...accepted].some(
          (i) =>
            i.file.name === file.name &&
            i.file.size === file.size &&
            i.file.lastModified === file.lastModified,
        )
      ) {
        issues.push(`${file.name} is already added.`);
        continue;
      }
      if (
        videoExtensions.includes(extension(file.name)) &&
        [...items, ...accepted].some((i) => videoExtensions.includes(extension(i.file.name)))
      ) {
        issues.push('Use one recording per document. You can add screenshots for missing steps.');
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        ...(videoExtensions.includes(extension(file.name)) ? await getVideoMetadata(file) : {}),
      });
      if (single) break;
    }
    if (accepted.length) onChange(single ? accepted : [...items, ...accepted]);
    setErrors(issues);
    setReading(false);
  }
  return (
    <div className={`upload-group ${compact ? 'compact' : ''}`}>
      <input
        ref={input}
        id={id}
        className="sr-only"
        type="file"
        accept={allowed.map((x) => `.${x}`).join(',')}
        multiple={!single}
        onChange={(e) => {
          void add(Array.from(e.target.files || []));
          e.target.value = '';
        }}
        disabled={reading}
      />
      <button
        type="button"
        className={`dropzone ${drag ? 'dragging' : ''}`}
        disabled={reading}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!reading) void add(Array.from(e.dataTransfer.files));
        }}
        aria-label={title}
      >
        <span className="upload-icon">
          {reading ? <LoaderCircle className="spin" size={23} /> : <Upload size={23} />}
        </span>
        <strong>{reading ? 'Reading file metadata…' : title}</strong>
        <span>{description}</span>
        <span className="file-types">{allowed.map((x) => x.toUpperCase()).join(' · ')}</span>
      </button>
      {errors.length > 0 && (
        <div role="alert" className="inline-error">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      <div className="file-list">
        {items.map((item) => {
          const video = videoExtensions.includes(extension(item.file.name));
          return (
            <div className="file-item" key={item.id}>
              <span className="file-icon">
                {video ? (
                  <Film size={20} />
                ) : ['png', 'jpg', 'jpeg', 'webp'].includes(extension(item.file.name)) ? (
                  <Image size={20} />
                ) : (
                  <FileText size={20} />
                )}
              </span>
              <div>
                <strong>{item.file.name}</strong>
                <small>
                  {formatSize(item.file.size)}
                  {item.duration !== undefined
                    ? milestoneBackend
                      ? ` · ${formatDuration(item.duration)} · backend selects up to 60 frames`
                      : ` · ${formatDuration(item.duration)} · ≈${Math.max(1, Math.round(item.duration / 8))} frames (estimate) · ${Math.max(1, Math.ceil(item.duration / 1200))} segment(s)`
                    : ''}
                </small>
                {item.metadataWarning && (
                  <small className="warning-text">{item.metadataWarning}</small>
                )}
                {!milestoneBackend && item.duration !== undefined && item.duration > 1200 && (
                  <small>Long recording: the backend will split and stitch by timestamp.</small>
                )}
              </div>
              <button
                className="icon-button"
                onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                aria-label={`Remove ${item.file.name}`}
              >
                <Trash2 size={17} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
