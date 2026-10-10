// All database updates involving evidence and job status are atomic.
// The API never exposes the on-disk filename, which is derived from server UUIDs.
export function createScreenshotRepository(db) {
  const selectByJob = db.prepare(`SELECT id, job_id, position, mime_type, byte_size, width, height, sha256, created_at
    FROM screenshots WHERE job_id = ? ORDER BY position`);
  const selectOne = db.prepare(`SELECT id, job_id, position, mime_type, byte_size, width, height, sha256, created_at
    FROM screenshots WHERE job_id = ? AND id = ?`);
  const selectStatus = db.prepare('SELECT status FROM jobs WHERE id = ?');
  const insert = db.prepare(`INSERT INTO screenshots
    (id, job_id, position, mime_type, byte_size, width, height, sha256, created_at)
    VALUES (?, ?, ?, 'image/png', ?, ?, ?, ?, ?)`);
  const moveAside = db.prepare('UPDATE screenshots SET position = position + 100 WHERE job_id = ?');
  const setPosition = db.prepare('UPDATE screenshots SET position = ? WHERE job_id = ? AND id = ?');
  const deleteOne = db.prepare('DELETE FROM screenshots WHERE id = ? AND job_id = ?');
  const touch = db.prepare('UPDATE jobs SET updated_at = ?, status = ? WHERE id = ?');

  const add = db.transaction((jobId, images) => {
    const job = selectStatus.get(jobId);
    if (!job || !['created', 'uploaded'].includes(job.status)) {
      throw new Error('JOB_NOT_UPLOADABLE');
    }
    const existing = selectByJob.all(jobId);
    if (existing.length + images.length > 12) throw new Error('TOO_MANY_SCREENSHOTS');
    const now = new Date().toISOString();
    for (const [index, image] of images.entries()) {
      insert.run(image.id, jobId, existing.length + index + 1,
        image.byteSize, image.width, image.height, image.sha256, now);
    }
    touch.run(now, 'uploaded', jobId);
    return selectByJob.all(jobId);
  });

  const reorder = db.transaction((jobId, imageIds) => {
    const current = selectByJob.all(jobId);
    if (current.length !== imageIds.length ||
      new Set(imageIds).size !== imageIds.length ||
      imageIds.some((id) => !current.some((row) => row.id === id))) {
      throw new Error('INVALID_SCREENSHOT_ORDER');
    }
    if (!['created', 'uploaded'].includes(selectStatus.get(jobId)?.status)) {
      throw new Error('JOB_NOT_UPLOADABLE');
    }
    // Two-phase update avoids transient UNIQUE(job_id, position) conflicts.
    moveAside.run(jobId);
    imageIds.forEach((imageId, index) => setPosition.run(index + 1, jobId, imageId));
    touch.run(new Date().toISOString(), current.length ? 'uploaded' : 'created', jobId);
    return selectByJob.all(jobId);
  });

  const remove = db.transaction((jobId, imageId) => {
    const current = selectOne.get(jobId, imageId);
    if (!current) return undefined;
    if (!['created', 'uploaded'].includes(selectStatus.get(jobId)?.status)) {
      throw new Error('JOB_NOT_UPLOADABLE');
    }
    deleteOne.run(imageId, jobId);
    const remainder = selectByJob.all(jobId);
    moveAside.run(jobId);
    remainder.forEach((row, index) => setPosition.run(index + 1, jobId, row.id));
    touch.run(new Date().toISOString(), remainder.length ? 'uploaded' : 'created', jobId);
    return current;
  });

  return Object.freeze({
    add,
    reorder,
    remove,
    list: (jobId) => selectByJob.all(jobId),
    get: (jobId, imageId) => selectOne.get(jobId, imageId),
  });
}
