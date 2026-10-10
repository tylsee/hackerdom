// Document drafts are snapshots. They never mutate the approved evidence analysis.
// JSON makes the intermediate representation suitable for future editing and DOCX export.
export function createDocumentRepository(db) {
  const find = db.prepare('SELECT * FROM document_drafts WHERE job_id = ?');
  const insert = db.prepare(`INSERT INTO document_drafts
    (id, job_id, revision, content_json, analysis_completed_at, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?)`);
  const replace = db.prepare(`UPDATE document_drafts
    SET revision = revision + 1, content_json = ?, analysis_completed_at = ?, updated_at = ?
    WHERE job_id = ?`);
  const save = db.transaction(({ id, jobId, content, analysisCompletedAt, timestamp, regenerate }) => {
    const existing = find.get(jobId);
    if (existing && !regenerate) throw new Error('DOCUMENT_ALREADY_EXISTS');
    if (existing) replace.run(JSON.stringify(content), analysisCompletedAt, timestamp, jobId);
    else insert.run(id, jobId, JSON.stringify(content), analysisCompletedAt, timestamp, timestamp);
    return find.get(jobId);
  });
  return Object.freeze({
    findByJob: (jobId) => find.get(jobId),
    save,
  });
}
