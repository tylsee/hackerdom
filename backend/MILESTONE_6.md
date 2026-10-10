# Milestone 6 — Evidence-grounded document drafting

Milestone 6 builds a **persistent, editable-in-a-later-milestone JSON document structure** from an already completed Gemini analysis. It does not invoke Gemini again, audit claims independently, apply an uploaded DOCX template or export Word files.

## Update without losing the working Milestone 5 installation

1. Stop `npm run dev` (Ctrl+C). Back up `backend/.env` and the entire `backend/storage/` directory, including any SQLite WAL/SHM files. Do not overwrite them with the ZIP.
2. Copy the ZIP's `backend/` **source files** over your existing backend, retaining your private `.env`, `storage/`, and local `node_modules/`. You can instead apply the incremental patch if provided.
3. From `~/Desktop/hackerdom/backend`, run `npm install`, `npm run check`, `npm test`.
4. Start `npm run dev`. Migration **v6** is applied automatically on startup. Existing jobs, video frames, screenshots, tokens, and Milestone 5 analysis remain intact.

There are **no new runtime dependencies** in Milestone 6. Keep your working `GEMINI_MODEL=gemini-3.5-flash` and API key in `.env`. You do **not** have to rerun Gemini analysis for an existing job whose `/analysis` status is `ready`.

## Generate the draft from your existing 5-step Excel job

In the terminal holding your real job credentials (never share the token):

```bash
curl -sS -X POST \
  "http://127.0.0.1:3000/api/jobs/$JOB_ID/document" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  -H 'Content-Type: application/json' -d '{}' \
  | python3 -m json.tool
```

Successful first generation returns HTTP **201** (or JSON when using this command). GET the saved document later:

```bash
curl -sS "http://127.0.0.1:3000/api/jobs/$JOB_ID/document" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  | python3 -m json.tool
```

Save to a local file (the result contains private workflow content):

```bash
curl -fsS "http://127.0.0.1:3000/api/jobs/$JOB_ID/document" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  | python3 -m json.tool > "$HOME/Desktop/hackerdom/docuai-document-draft.json"
```

To **explicitly replace** an existing draft after changing job metadata (or wanting a fresh snapshot), run:

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/jobs/$JOB_ID/document" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  -H 'Content-Type: application/json' -d '{"regenerate":true}' \
  | python3 -m json.tool
```

Regeneration increments `revision` and retains the original draft ID and createdAt timestamp; the old snapshot is replaced. The API rejects accidental overwrites without `regenerate:true` (409).

## Document JSON shape

`document` contains `title`, `documentType`, `writingTone`, `sourceInputType`, `sections`, `stepCount`, `reviewCount`, and persistence metadata. Each section has one of three `kind` values:

- `text`: heading and user-supplied metadata paragraphs (omitted when metadata is absent).
- `procedure`: structured step objects with original title, instruction, explanation, caption, expected result, estimated video timestamps, support status, and `selectedEvidence`.
- `review`: uncertainties/unsupported evidence that require human review (only when needed).

The composition rules provide four layouts: SOP (Purpose → Procedure), Tutorial (Overview → Steps), User Manual (Overview → Instructions), and Lab Report (Aim → Method). Additional headings, such as Objectives and Intended Audience, appear **only when the user supplied the relevant metadata**. No prerequisites, safety rules, tool names, observation claims or missing actions are invented.

### Image selection and retrieval

For each analyzed step, the draft selects the **last frame or screenshot ID cited for that step**. This is a reproducible heuristic generally favoring the end state, **not visual-quality detection or independent factual verification**. If the step has no cited image, `selectedEvidence` is `null`. If an analysis citation no longer exists in job metadata, generation fails with 409 rather than inserting a broken reference.

`selectedEvidence` includes `id`, `kind`, `order`, `timestampMs`, and `retrievalPath` (e.g. `/api/jobs/<job-uuid>/video/frames/<frame-uuid>`). Fetch the bytes with `Authorization: Bearer $JOB_TOKEN` using the existing screenshot/video route. **These are private paths**: a plain `<img src="...">` without an Authorization header will not work. In a frontend, use an authenticated fetch, then display a Blob/object URL and revoke it when finished.

Video timestamps are sampled-frame-based estimates. `supportStatus: supported` means Gemini cited evidence, not that the claim was independently verified. Inspect step text and evidence before publication.

## Failure modes

- `401` missing/malformed bearer token; `404 JOB_NOT_FOUND` incorrect token or job; `404 DOCUMENT_NOT_FOUND` no saved draft.
- `409 ANALYSIS_NOT_READY` analysis is absent, processing, or failed; complete Milestone 5 first.
- `409 DOCUMENT_ALREADY_EXISTS` an existing draft must be explicitly regenerated.
- `409 DOCUMENT_EVIDENCE_MISSING` a referenced screenshot/frame is absent from metadata.
- `400 INVALID_DOCUMENT_REQUEST` body has unknown or invalid fields; use `{}` or `{ "regenerate": true }`.

## Verification

`test/document.test.js` checks screenshot and video drafting, metadata-only composition, bearer authorization, evidence ID selection, review flags, persistence, explicit regeneration, job-deletion cascade, and migration from an existing **v5 database**. It uses a fake Gemini response in tests; production document composition uses the real persisted analysis and makes no extra model call.

No Word, PDF, HTML rendering, DOCX template parsing, AI audit, or interactive text editing is implemented in this milestone. Those require later milestones.
