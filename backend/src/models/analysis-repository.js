// All step saves and job-status changes are transactional. Generated evidence
// IDs are additionally validated against the owning job in analysis-service.
export function createAnalysisRepository(db) {
  const jobStatus = db.prepare('SELECT status FROM jobs WHERE id = ?');
  const get = db.prepare('SELECT * FROM analyses WHERE job_id = ?');
  const list = db.prepare('SELECT * FROM analysis_steps WHERE job_id = ? ORDER BY position');
  const stepsDelete = db.prepare('DELETE FROM analysis_steps WHERE job_id = ?');
  const insertStep = db.prepare(`INSERT INTO analysis_steps
    (id, job_id, position, title, instruction, explanation, expected_result,
      caption, evidence_ids_json, start_timestamp_ms, end_timestamp_ms,
      support_status, review_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsert = db.prepare(`INSERT INTO analyses
    (job_id, status, model, error_code, started_at, updated_at, completed_at)
    VALUES (?, 'queued', ?, NULL, ?, ?, NULL)
    ON CONFLICT(job_id) DO UPDATE SET status='queued', model=excluded.model,
      error_code=NULL, started_at=excluded.started_at,
      updated_at=excluded.updated_at, completed_at=NULL`);
  const state = db.prepare(`UPDATE analyses SET status = ?, error_code = ?,
    updated_at = ?, completed_at = ? WHERE job_id = ?`);
  const jobState = db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?');
  const pendingSelect = db.prepare("SELECT job_id FROM analyses WHERE status IN ('queued', 'processing')");

  const enqueue = db.transaction((jobId, model) => {
    const status = jobStatus.get(jobId)?.status;
    if (!['uploaded', 'failed'].includes(status)) throw new Error('JOB_NOT_ANALYZABLE');
    if (get.get(jobId)?.status === 'ready') throw new Error('ANALYSIS_ALREADY_READY');
    const now = new Date().toISOString();
    stepsDelete.run(jobId);
    upsert.run(jobId, model, now, now);
    jobState.run('processing', now, jobId);
    return get.get(jobId);
  });
  const markProcessing = db.transaction((jobId) => {
    const row = get.get(jobId);
    if (!row || !['queued', 'processing'].includes(row.status)) return null;
    if (jobStatus.get(jobId)?.status !== 'processing') throw new Error('ANALYSIS_INVALID_JOB_STATE');
    state.run('processing', null, new Date().toISOString(), null, jobId);
    return get.get(jobId);
  });
  const complete = db.transaction((jobId, steps) => {
    if (get.get(jobId)?.status !== 'processing') throw new Error('ANALYSIS_NOT_RUNNING');
    stepsDelete.run(jobId);
    for (const step of steps) {
      insertStep.run(step.id, jobId, step.order, step.title, step.instruction,
        step.explanation, step.expectedResult, step.caption,
        JSON.stringify(step.evidenceIds), step.startTimestampMs,
        step.endTimestampMs, step.supportStatus, step.reviewNote);
    }
    const now = new Date().toISOString();
    state.run('ready', null, now, now, jobId);
    jobState.run('ready', now, jobId);
  });
  const fail = db.transaction((jobId, code) => {
    if (!get.get(jobId)) return;
    const now = new Date().toISOString();
    stepsDelete.run(jobId);
    state.run('failed', code, now, now, jobId);
    if (jobStatus.get(jobId)?.status === 'processing') jobState.run('failed', now, jobId);
  });
  return Object.freeze({
    enqueue, markProcessing, complete, fail,
    findByJob: (jobId) => get.get(jobId),
    listSteps: (jobId) => list.all(jobId),
    pending: () => pendingSelect.all().map((r) => r.job_id),
  });
}
