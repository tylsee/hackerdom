import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile, readdir, rename, rm, mkdir, chmod, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { AppError } from '../utils/app-error.js';

const execute = promisify(execFile);
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const MAX_DURATION_MS = 180_000;
export const MAX_VIDEO_FRAMES = 60;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function publicVideo(video, frames = []) {
  if (!video) return null;
  return {
    id: video.id, mimeType: video.mime_type, byteSize: video.byte_size,
    durationMs: video.duration_ms, width: video.width, height: video.height,
    processingStatus: video.frame_status, errorCode: video.error_code,
    // Estimated sample times; these do not imply procedural step boundaries.
    frames: frames.map((frame) => ({ id: frame.id, order: frame.position,
      timestampMs: frame.timestamp_ms, width: frame.width, height: frame.height,
      byteSize: frame.byte_size, sha256: frame.sha256 })),
    createdAt: video.created_at, updatedAt: video.updated_at,
  };
}

async function runCommand(bin, args, { timeout = 30_000, signal } = {}) {
  try {
    return await execute(bin, args, { timeout, signal, maxBuffer: 1024 * 1024, windowsHide: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError(503, 'VIDEO_TOOLS_UNAVAILABLE', 'Install FFmpeg and ffprobe to process screen recordings.');
    }
    throw error;
  }
}

async function validateVideo(file, { ffprobePath }) {
  if (!file || !file.path || !file.size) {
    throw new AppError(400, 'MISSING_VIDEO', 'Upload one nonempty screen recording.');
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new AppError(413, 'VIDEO_TOO_LARGE', 'The recording exceeds the 80 MB limit.');
  }
  // Check container signatures before starting FFmpeg. MIME types and filenames
  // come from the client and are NOT proof of file format.
  const descriptor = await open(file.path, 'r');
  let head;
  try {
    head = Buffer.alloc(16);
    await descriptor.read(head, 0, 16, 0);
  } finally {
    await descriptor.close();
  }
  const ebml = head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const isoBaseMedia = head.toString('ascii', 4, 8) === 'ftyp';
  if (!ebml && !isoBaseMedia) {
    throw new AppError(415, 'INVALID_VIDEO', 'Recording must be a valid MP4, MOV or WebM video.');
  }
  let result;
  try {
    result = await runCommand(ffprobePath, [
      '-protocol_whitelist', 'file,pipe', '-v', 'error', '-show_entries',
      'format=duration,format_name:stream=codec_type,width,height',
      '-of', 'json', '--', file.path,
    ], { timeout: 25_000 });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(415, 'INVALID_VIDEO', 'Recording could not be decoded as a video.');
  }
  let data;
  try { data = JSON.parse(result.stdout); }
  catch { throw new AppError(415, 'INVALID_VIDEO', 'Recording has invalid media metadata.'); }
  const stream = data.streams?.find((item) => item.codec_type === 'video');
  const duration = Number(data.format?.duration);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const format = data.format?.format_name ?? '';
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(width) ||
    !Number.isFinite(height) || width < 1 || height < 1 ||
    width > 4096 || height > 2160 || duration * 1000 > MAX_DURATION_MS) {
    throw new AppError(413, 'VIDEO_LIMIT_EXCEEDED', 'Video must be at most 180 seconds and 4096×2160 pixels.');
  }
  let ext, mime;
  if (ebml && /(^|,)matroska|webm/.test(format)) {
    ext = 'webm'; mime = 'video/webm';
  } else if (isoBaseMedia && /(mov|mp4|m4a|3gp)/.test(format)) {
    // QuickTime brand is 'qt  '; other ISO files are stored as MP4.
    ext = head.toString('ascii', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
    mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  } else {
    throw new AppError(415, 'INVALID_VIDEO', 'Unsupported video container.');
  }
  if ((file.mimetype === 'video/webm') !== (ext === 'webm')) {
    throw new AppError(415, 'VIDEO_MIME_MISMATCH', 'Uploaded media type does not match the video container.');
  }
  return { ext, mime, byteSize: file.size, durationMs: Math.max(1, Math.round(duration * 1000)),
    width: Math.round(width), height: Math.round(height), id: randomUUID() };
}

function difference(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

// FFmpeg is a frame sampler, not an action-recognition system. In Milestone 5,
// Gemini will infer procedural steps using these timestamped frames or the video.
async function extractFrames(video, source, workDir, { ffmpegPath, signal }) {
  const rawDir = join(workDir, 'raw');
  await mkdir(rawDir, { recursive: true, mode: 0o700 });
  const fps = Math.min(1, MAX_VIDEO_FRAMES / (video.duration_ms / 1000));
  const pattern = join(rawDir, 'frame_%04d.png');
  try {
    await runCommand(ffmpegPath, [
      '-nostdin', '-protocol_whitelist', 'file,pipe', '-hide_banner', '-loglevel', 'error',
      '-i', source, '-map', '0:v:0', '-an',
      '-vf', `fps=${fps.toFixed(6)},scale=1280:720:force_original_aspect_ratio=decrease`,
      '-frames:v', String(MAX_VIDEO_FRAMES), '-start_number', '0', '-y', pattern,
    ], { timeout: 120_000, signal });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new Error('FFMPEG_EXTRACTION_FAILED');
  }
  const names = (await readdir(rawDir)).filter((name) => /^frame_\d{4}\.png$/.test(name)).sort();
  if (!names.length) throw new Error('NO_VIDEO_FRAMES');
  const proposals = [];
  let previousFingerprint = null;
  let previousSelectedMs = -Infinity;
  for (const [index, name] of names.entries()) {
    const path = join(rawDir, name);
    const processor = sharp(path, { limitInputPixels: 4096 * 2160 });
    const fingerprint = await processor.clone().resize(64, 36, { fit: 'fill' }).grayscale().raw().toBuffer();
    const timestampMs = Math.min(video.duration_ms, Math.round(index * 1000 / fps));
    // Keep visual changes and periodic anchors for static, long-running screens.
    const keep = index === 0 || index === names.length - 1 ||
      difference(previousFingerprint, fingerprint) >= 7 || timestampMs - previousSelectedMs >= 12000;
    if (!keep) continue;
    const normalized = await processor.png({ compressionLevel: 6 }).toBuffer();
    const metadata = await sharp(normalized).metadata();
    proposals.push({ id: randomUUID(), timestampMs, normalized,
      width: metadata.width, height: metadata.height, byteSize: normalized.length,
      sha256: createHash('sha256').update(normalized).digest('hex') });
    previousFingerprint = fingerprint;
    previousSelectedMs = timestampMs;
  }
  return proposals;
}

export function createVideoService(repository, { uploadRoot, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' }) {
  const root = (jobId) => join(uploadRoot, jobId, 'video');
  const sourcePath = (jobId, video) => join(root(jobId), `${video.id}.${video.storage_ext}`);
  const framePath = (jobId, frameId) => join(root(jobId), 'frames', `${frameId}.png`);
  const temporaryDirectory = join(uploadRoot, '.incoming');
  const waiting = [];
  let working = null;
  let stopping = false;
  let activeController = null;

  async function processJob(jobId) {
    const video = repository.markProcessing(jobId);
    if (!video) return;
    const controller = new AbortController();
    activeController = controller;
    const destination = join(root(jobId), 'frames');
    const staging = join(root(jobId), `.staging-${randomUUID()}`);
    try {
      await rm(destination, { recursive: true, force: true });
      await mkdir(destination, { recursive: true, mode: 0o700 });
      await mkdir(staging, { recursive: true, mode: 0o700 });
      const frames = await extractFrames(video, sourcePath(jobId, video), staging,
        { ffmpegPath, signal: controller.signal });
      if (stopping) return; // State 'processing' is recoverable on next startup.
      for (const frame of frames) {
        await writeFile(framePath(jobId, frame.id), frame.normalized, { flag: 'wx', mode: 0o600 });
      }
      repository.finish(video.id, frames);
    } catch {
      if (!stopping) {
        await rm(destination, { recursive: true, force: true }).catch(() => {});
        repository.fail(video.id);
      }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      activeController = null;
    }
  }

  function schedule(jobId) {
    if (stopping || waiting.includes(jobId)) return;
    waiting.push(jobId);
    if (working) return;
    // Schedule outside the request: the client receives HTTP 202 immediately.
    working = (async () => {
      while (waiting.length && !stopping) await processJob(waiting.shift());
    })().finally(() => { working = null; });
  }

  return Object.freeze({
    temporaryDirectory,
    list(jobId) {
      const video = repository.findByJob(jobId);
      return publicVideo(video, video ? repository.listFrames(video.id) : []);
    },
    async add(jobId, file) {
      const video = await validateVideo(file, { ffprobePath });
      const dir = root(jobId);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') await chmod(dir, 0o700);
      const stored = join(dir, `${video.id}.${video.ext}`);
      await rename(file.path, stored);
      try { repository.add(jobId, video); }
      catch (error) {
        await rm(stored, { force: true }).catch(() => {});
        if (error.message === 'VIDEO_ALREADY_EXISTS' || error.message === 'JOB_NOT_UPLOADABLE') {
          throw new AppError(409, 'VIDEO_ALREADY_EXISTS', 'The job already has evidence or cannot accept a video.');
        }
        throw error;
      }
      schedule(jobId);
      return this.list(jobId);
    },
    async getOriginal(jobId) {
      const video = repository.findByJob(jobId);
      if (!video) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Screen recording not found.');
      try { return { data: await readFile(sourcePath(jobId, video)), mime: video.mime_type }; }
      catch { throw new AppError(503, 'VIDEO_UNAVAILABLE', 'Screen recording could not be read.'); }
    },
    async getFrame(jobId, frameId) {
      if (!uuidPattern.test(frameId)) throw new AppError(400, 'INVALID_FRAME_ID', 'Frame ID must be a UUID.');
      const frame = repository.getFrame(jobId, frameId);
      if (!frame || repository.findByJob(jobId)?.frame_status !== 'ready') {
        throw new AppError(404, 'FRAME_NOT_FOUND', 'Video frame not found.');
      }
      try { return await readFile(framePath(jobId, frameId)); }
      catch { throw new AppError(503, 'FRAME_UNAVAILABLE', 'Video frame could not be read.'); }
    },
    async remove(jobId) {
      const video = repository.findByJob(jobId);
      if (!video) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Screen recording not found.');
      try { repository.remove(jobId); }
      catch { throw new AppError(409, 'VIDEO_BUSY', 'Cannot delete video while it is processing or the job is locked.'); }
      await rm(root(jobId), { recursive: true, force: true });
    },
    assertCanDeleteJob(jobId) {
      const video = repository.findByJob(jobId);
      if (video && !['ready', 'failed'].includes(video.frame_status)) {
        throw new AppError(409, 'VIDEO_BUSY', 'Wait for video preparation to finish before deleting this job.');
      }
    },
    resumePending() { for (const jobId of repository.pending()) schedule(jobId); },
    async shutdown() {
      stopping = true;
      waiting.length = 0;
      activeController?.abort();
      if (working) await working;
    },
  });
}
