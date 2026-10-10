import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { AppError } from '../utils/app-error.js';

export const MAX_SCREENSHOTS = 12;
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const allowedFormats = new Set(['png', 'jpeg', 'webp']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function publicImage(row) {
  return {
    id: row.id,
    order: row.position,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function mappedError(error) {
  if (error.message === 'TOO_MANY_SCREENSHOTS') {
    return new AppError(413, 'SCREENSHOT_LIMIT_EXCEEDED', `Maximum ${MAX_SCREENSHOTS} screenshots per job.`);
  }
  if (error.message === 'INVALID_SCREENSHOT_ORDER') {
    return new AppError(400, 'INVALID_SCREENSHOT_ORDER', 'Provide every existing screenshot ID exactly once.');
  }
  if (error.message === 'JOB_NOT_UPLOADABLE') {
    return new AppError(409, 'JOB_NOT_UPLOADABLE', 'Screenshot edits are not allowed in the current job state.');
  }
  return error;
}

export function createScreenshotService(repository, { uploadRoot }) {
  // Root and temporary directory are server-controlled and excluded from source control.
  mkdirSync(uploadRoot, { recursive: true, mode: 0o700 });
  mkdirSync(join(uploadRoot, '.incoming'), { recursive: true, mode: 0o700 });
  const temporaryDirectory = join(uploadRoot, '.incoming');
  const filePath = (jobId, imageId) => join(uploadRoot, jobId, `${imageId}.png`);

  async function processFile(file) {
    try {
      const processor = sharp(file.path, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
      const metadata = await processor.metadata();
      const rotated = [5, 6, 7, 8].includes(metadata.orientation);
      const width = rotated ? metadata.height : metadata.width;
      const height = rotated ? metadata.width : metadata.height;
      if (!allowedFormats.has(metadata.format) || !width || !height ||
        width * height > MAX_PIXELS || (metadata.pages ?? 1) !== 1) {
        throw new Error('invalid image type, dimensions or frame count');
      }
      // Re-encode to strip ancillary metadata and EXIF, and to correct orientation.
      const normalized = await processor.rotate().png({ compressionLevel: 6 }).toBuffer();
      if (normalized.length > MAX_NORMALIZED_BYTES) {
        throw new AppError(413, 'NORMALIZED_IMAGE_TOO_LARGE', 'Decoded screenshot is too large.');
      }
      return {
        id: randomUUID(), width, height, byteSize: normalized.length,
        sha256: createHash('sha256').update(normalized).digest('hex'),
        normalized,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(415, 'INVALID_IMAGE', 'Screenshot must contain a valid PNG, JPEG or WebP image.');
    }
  }

  return Object.freeze({
    temporaryDirectory,
    list(jobId) { return repository.list(jobId).map(publicImage); },
    async add(jobId, files) {
      if (!files?.length) throw new AppError(400, 'MISSING_SCREENSHOTS', 'Upload at least one screenshot.');
      if (repository.list(jobId).length + files.length > MAX_SCREENSHOTS) {
        throw new AppError(413, 'SCREENSHOT_LIMIT_EXCEEDED', `Maximum ${MAX_SCREENSHOTS} screenshots per job.`);
      }
      const writtenPaths = [];
      try {
        const images = [];
        const dir = join(uploadRoot, jobId);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        // Enforce private directory permissions even when already present.
        if (process.platform !== 'win32') await chmod(dir, 0o700);
        // Process and persist each image sequentially to bound RAM usage. If any
        // later conversion or SQL write fails, discard every new file below.
        for (const file of files) {
          const image = await processFile(file);
          const path = filePath(jobId, image.id);
          await writeFile(path, image.normalized, { flag: 'wx', mode: 0o600 });
          writtenPaths.push(path);
          images.push({ id: image.id, width: image.width, height: image.height,
            byteSize: image.byteSize, sha256: image.sha256 });
        }
        return repository.add(jobId, images).map(publicImage);
      } catch (error) {
        await Promise.all(writtenPaths.map((path) => rm(path, { force: true }).catch(() => {})));
        throw mappedError(error);
      }
    },
    reorder(jobId, imageIds) {
      try { return repository.reorder(jobId, imageIds).map(publicImage); }
      catch (error) { throw mappedError(error); }
    },
    async getFile(jobId, imageId) {
      if (!uuidPattern.test(imageId)) throw new AppError(400, 'INVALID_IMAGE_ID', 'Screenshot ID must be a UUID.');
      const row = repository.get(jobId, imageId);
      if (!row) throw new AppError(404, 'SCREENSHOT_NOT_FOUND', 'Screenshot not found.');
      try { return await readFile(filePath(jobId, imageId)); }
      catch { throw new AppError(503, 'SCREENSHOT_UNAVAILABLE', 'Screenshot could not be read from storage.'); }
    },
    async remove(jobId, imageId) {
      if (!uuidPattern.test(imageId)) throw new AppError(400, 'INVALID_IMAGE_ID', 'Screenshot ID must be a UUID.');
      let removed;
      try { removed = repository.remove(jobId, imageId); }
      catch (error) { throw mappedError(error); }
      if (!removed) throw new AppError(404, 'SCREENSHOT_NOT_FOUND', 'Screenshot not found.');
      await rm(filePath(jobId, imageId), { force: true });
      return repository.list(jobId).map(publicImage);
    },
    async purgeJob(jobId) {
      // Job IDs originate from validated UUIDs, never user-controlled paths.
      if (!uuidPattern.test(jobId)) return;
      await rm(join(uploadRoot, jobId), { recursive: true, force: true });
    },
  });
}
