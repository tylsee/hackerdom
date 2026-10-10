export function createTemplateRepository(db) {
  const find = db.prepare('SELECT * FROM job_templates WHERE job_id = ?');
  const upsert = db.prepare(`INSERT INTO job_templates
    (id, job_id, filename, byte_size, sha256, profile_json, created_at, updated_at)
    VALUES (@id, @jobId, @filename, @byteSize, @sha256, @profileJson, @createdAt, @updatedAt)
    ON CONFLICT(job_id) DO UPDATE SET id=excluded.id, filename=excluded.filename,
      byte_size=excluded.byte_size, sha256=excluded.sha256,
      profile_json=excluded.profile_json, updated_at=excluded.updated_at`);
  const erase = db.prepare('DELETE FROM job_templates WHERE job_id = ?');
  return Object.freeze({
    get: (jobId) => find.get(jobId) ?? null,
    save: db.transaction((record) => {
      const before = find.get(record.jobId) ?? null;
      upsert.run(record);
      return before;
    }),
    delete: (jobId) => erase.run(jobId).changes > 0,
  });
}
