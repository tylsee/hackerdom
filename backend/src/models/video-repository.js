// Video state is independent of a job's AI-analysis state. Job.status remains
// 'uploaded' once valid video evidence is committed; AI work starts in M5.
export function createVideoRepository(db) {
  const get = db.prepare(`SELECT * FROM job_videos WHERE job_id = ?`);
  const getVideo = db.prepare(`SELECT * FROM job_videos WHERE id = ?`);
  const getJobStatus = db.prepare(`SELECT status FROM jobs WHERE id = ?`);
  const listFrames = db.prepare(`SELECT id, video_id, position, timestamp_ms, byte_size, width, height, sha256
    FROM video_frames WHERE video_id = ? ORDER BY position`);
  const getFrame = db.prepare(`SELECT f.* FROM video_frames f
    JOIN job_videos v ON v.id = f.video_id WHERE v.job_id = ? AND f.id = ?`);
  const insert = db.prepare(`INSERT INTO job_videos
    (id, job_id, storage_ext, mime_type, byte_size, duration_ms, width, height, frame_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`);
  const insertFrame = db.prepare(`INSERT INTO video_frames
    (id, video_id, position, timestamp_ms, byte_size, width, height, sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const setState = db.prepare(`UPDATE job_videos SET frame_status = ?, error_code = ?, updated_at = ? WHERE id = ?`);
  const setJobUploaded = db.prepare(`UPDATE jobs SET status = 'uploaded', updated_at = ? WHERE id = ? AND status = 'created'`);
  const setJobCreated = db.prepare(`UPDATE jobs SET status = 'created', updated_at = ? WHERE id = ? AND status = 'uploaded'`);
  const deleteVideo = db.prepare('DELETE FROM job_videos WHERE job_id = ?');
  const deleteFrames = db.prepare('DELETE FROM video_frames WHERE video_id = ?');
  const pending = db.prepare("SELECT job_id FROM job_videos WHERE frame_status IN ('queued','processing')");

  const add = db.transaction((jobId, video) => {
    if (getJobStatus.get(jobId)?.status !== 'created' || get.get(jobId)) {
      throw new Error('VIDEO_ALREADY_EXISTS');
    }
    const now = new Date().toISOString();
    insert.run(video.id, jobId, video.ext, video.mime, video.byteSize,
      video.durationMs, video.width, video.height, now, now);
    if (setJobUploaded.run(now, jobId).changes !== 1) throw new Error('JOB_NOT_UPLOADABLE');
    return get.get(jobId);
  });

  const markProcessing = db.transaction((jobId) => {
    const row = get.get(jobId);
    if (!row || !['queued', 'processing'].includes(row.frame_status)) return undefined;
    setState.run('processing', null, new Date().toISOString(), row.id);
    // Clear any stale frame references in the same transaction.
    deleteFrames.run(row.id);
    return get.get(jobId);
  });

  const finish = db.transaction((videoId, frames) => {
    const video = getVideo.get(videoId);
    if (!video || video.frame_status !== 'processing') throw new Error('VIDEO_NOT_PROCESSING');
    deleteFrames.run(videoId);
    for (const [i, frame] of frames.entries()) {
      insertFrame.run(frame.id, videoId, i + 1, frame.timestampMs,
        frame.byteSize, frame.width, frame.height, frame.sha256);
    }
    setState.run('ready', null, new Date().toISOString(), videoId);
  });

  const remove = db.transaction((jobId) => {
    const video = get.get(jobId);
    if (!video) return undefined;
    if (!['ready', 'failed'].includes(video.frame_status) || getJobStatus.get(jobId)?.status !== 'uploaded') {
      throw new Error('VIDEO_BUSY');
    }
    deleteVideo.run(jobId);
    setJobCreated.run(new Date().toISOString(), jobId);
    return video;
  });

  return Object.freeze({
    add, markProcessing, finish, remove,
    findByJob: (jobId) => get.get(jobId),
    getFrame: (jobId, frameId) => getFrame.get(jobId, frameId),
    listFrames: (videoId) => listFrames.all(videoId),
    pending: () => pending.all().map((row) => row.job_id),
    fail: (videoId, code = 'FRAME_EXTRACTION_FAILED') =>
      setState.run('failed', code, new Date().toISOString(), videoId),
  });
}
