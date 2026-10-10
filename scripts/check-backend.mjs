// Creates then deletes one temporary job to verify Milestone 7 API/auth wiring.
// Does not access Gemini, upload private evidence, or print an access token.
const base = (process.env.DOCUAI_BACKEND_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const fetchJson = async (path, options) => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(10000), ...options });
  const result = response.status === 204 ? null : await response.json();
  return { status: response.status, data: result };
};
let job, token;
try {
  const health = await fetchJson('/health');
  if (health.status !== 200 || health.data.version !== '0.7.0')
    throw new Error(`Expected Milestone 7 backend on ${base}; found version ${health.data?.version ?? health.status}`);
  console.log('PASS: Health endpoint and backend v0.7.0');
  const created = await fetchJson('/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: { writingTone: 'professional', documentType: 'sop', inputType: 'screenshots' },
      metadata: { title: 'Integration smoke test' } }),
  });
  if (created.status !== 201 || !created.data?.job?.id || !created.data.accessToken)
    throw new Error('Could not create private integration test job.');
  job = created.data.job.id; token = created.data.accessToken;
  console.log('PASS: Private job created (token not displayed)');
  const unauth = await fetchJson(`/api/jobs/${job}`);
  if (unauth.status !== 401) throw new Error('Job endpoint did not reject missing token.');
  console.log('PASS: Private route requires bearer token');
  const headers = { Authorization: `Bearer ${token}` };
  const read = await fetchJson(`/api/jobs/${job}`, { headers });
  if (read.status !== 200 || read.data.job?.id !== job) throw new Error('Could not read private job.');
  console.log('PASS: Authorized job read');
  const profile = await fetchJson(`/api/jobs/${job}/template`, { headers });
  if (profile.status !== 200 || profile.data.template?.source !== 'default')
    throw new Error('Milestone 7 template API is not available.');
  console.log('PASS: Default DOCX template profile');
  const noAnalysis = await fetchJson(`/api/jobs/${job}/document`, { headers });
  if (noAnalysis.status !== 404 || noAnalysis.data.error?.code !== 'DOCUMENT_NOT_FOUND')
    throw new Error(`Unexpected document endpoint response: ${noAnalysis.status} ${noAnalysis.data?.error?.code ?? ''}`);
  console.log('PASS: Document endpoint registered (expected no draft on new job)');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  if (job && token) {
    try {
      const removed = await fetchJson(`/api/jobs/${job}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (removed.status === 204) console.log('PASS: Temporary test job deleted');
      else console.error('WARNING: Temporary test job cleanup returned', removed.status);
    } catch { console.error('WARNING: Could not delete the temporary test job.'); }
  }
}
