export function createJobRepository(db) {
  const insertJob = db.prepare(`INSERT INTO jobs
    (id, access_token_hash, status, created_at, updated_at) VALUES (?, ?, 'created', ?, ?)`);
  const insertPreferences = db.prepare(`INSERT INTO job_preferences
    (job_id, writing_tone, document_type, input_type) VALUES (?, ?, ?, ?)`);
  const insertMetadata = db.prepare(`INSERT INTO job_metadata
    (job_id, title, process_description, intended_audience, objectives_json, additional_context, special_requirements)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const findJob = db.prepare(`SELECT j.id, j.access_token_hash, j.status, j.created_at, j.updated_at,
    p.writing_tone, p.document_type, p.input_type, m.title, m.process_description, m.intended_audience,
    m.objectives_json, m.additional_context, m.special_requirements, m.source
    FROM jobs j JOIN job_preferences p ON p.job_id = j.id JOIN job_metadata m ON m.job_id = j.id
    WHERE j.id = ?`);
  const updatePreferences = db.prepare(`UPDATE job_preferences SET
    writing_tone = ?, document_type = ?, input_type = ? WHERE job_id = ?`);
  const updateMetadata = db.prepare(`UPDATE job_metadata SET
    title = ?, process_description = ?, intended_audience = ?, objectives_json = ?,
    additional_context = ?, special_requirements = ? WHERE job_id = ?`);
  const touchJob = db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?');
  const deleteJob = db.prepare('DELETE FROM jobs WHERE id = ?');
  const transition = db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND status = ?');

  const create = db.transaction(({ id, accessTokenHash, timestamp, preferences, metadata }) => {
    insertJob.run(id, accessTokenHash, timestamp, timestamp);
    insertPreferences.run(id, preferences.writingTone, preferences.documentType, preferences.inputType);
    insertMetadata.run(id, metadata.title ?? null, metadata.processDescription ?? null,
      metadata.intendedAudience ?? null, JSON.stringify(metadata.objectives ?? []),
      metadata.additionalContext ?? null, metadata.specialRequirements ?? null);
    return findJob.get(id);
  });

  const update = db.transaction((id, patch, timestamp) => {
    const row = findJob.get(id);
    if (!row) return undefined;
    const p = patch.preferences ?? {};
    const m = patch.metadata ?? {};
    updatePreferences.run(p.writingTone ?? row.writing_tone,
      p.documentType ?? row.document_type, p.inputType ?? row.input_type, id);
    updateMetadata.run(
      m.title === undefined ? row.title : m.title,
      m.processDescription === undefined ? row.process_description : m.processDescription,
      m.intendedAudience === undefined ? row.intended_audience : m.intendedAudience,
      m.objectives === undefined ? row.objectives_json : JSON.stringify(m.objectives),
      m.additionalContext === undefined ? row.additional_context : m.additionalContext,
      m.specialRequirements === undefined ? row.special_requirements : m.specialRequirements,
      id,
    );
    touchJob.run(timestamp, id);
    return findJob.get(id);
  });

  // Future milestone services (upload/analysis) call this internal method. It is
  // deliberately NOT an HTTP endpoint: clients cannot claim their own status.
  const allowedTransitions = Object.freeze({
    created: ['uploaded', 'failed'],
    uploaded: ['processing', 'failed'],
    processing: ['ready', 'failed'],
    failed: ['processing'],
    ready: [],
  });
  function transitionStatus(id, expected, next, timestamp) {
    if (!allowedTransitions[expected]?.includes(next)) {
      throw new RangeError('Invalid job status transition');
    }
    return transition.run(next, timestamp, id, expected).changes === 1;
  }

  return Object.freeze({
    create,
    findById: (id) => findJob.get(id),
    update,
    deleteById: (id) => deleteJob.run(id).changes === 1,
    transitionStatus,
  });
}

export function toPublicJob(row) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preferences: {
      writingTone: row.writing_tone,
      documentType: row.document_type,
      inputType: row.input_type,
    },
    metadata: {
      title: row.title,
      processDescription: row.process_description,
      intendedAudience: row.intended_audience,
      objectives: JSON.parse(row.objectives_json),
      additionalContext: row.additional_context,
      specialRequirements: row.special_requirements,
      source: row.source,
    },
  };
}
