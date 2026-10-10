import type { UploadItem } from '../types';
export const videoExtensions = ['mp4', 'mov', 'mkv', 'webm'];
export const imageExtensions = ['png', 'jpg', 'jpeg', 'webp'];
export function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}
export function validateFile(file: File, allowed: string[]): string | null {
  if (!allowed.includes(extension(file.name)))
    return `${file.name}: choose ${allowed.map((x) => x.toUpperCase()).join(', ')} files.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}
export function formatSize(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
export function getVideoMetadata(file: File): Promise<Partial<UploadItem>> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (data: Partial<UploadItem>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(data);
    };
    const timer = setTimeout(
      () =>
        finish({
          metadataWarning:
            'Duration unavailable in this browser. The backend can still accept this format.',
        }),
      5000,
    );
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      finish(
        Number.isFinite(video.duration)
          ? { duration: video.duration }
          : { metadataWarning: 'Duration unavailable.' },
      );
    video.onerror = () =>
      finish({
        metadataWarning: 'This browser cannot preview the codec. The backend will normalise it.',
      });
    video.src = url;
  });
}
