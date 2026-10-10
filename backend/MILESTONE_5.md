# Milestone 5 — Gemini AI screenshot and video-frame analysis

This implementation **does not generate DOCX files**; document composition, template filling, editing, and optional independent audits are later milestones.

## Installation on Mac

1. Back up your original `backend/storage/` (including `.sqlite`, `-wal`, `-shm` if present) and `.env`; stop the previous server.
2. Copy the updated source into `backend/`, retaining your original `storage/` and `.env`.
3. Run `npm install` to add the **official** `@google/genai` SDK, then `npm run check`, `npm test`.
4. Add `GEMINI_API_KEY=...` to your existing `.env` (obtained in Google AI Studio), and optionally `GEMINI_MODEL=gemini-2.5-flash`. Check the model ID is enabled in your Google account.
5. Run `npm run dev`. Never paste your real API key into chat, a repository, or frontend JavaScript.

Environment: the API key is optional for running health/upload endpoints but **required** to start a live analysis. Live Google API calls will consume your provider quota and may incur charges. Images are transferred to your configured AI provider. Inspect privacy and retention terms before uploading confidential captures.

## Start AI analysis

First create a job, upload screenshots in order **or** upload a video and poll `GET /api/jobs/:id/video` until `processingStatus` is `ready`.

From Terminal, use the real job ID and secret bearer token (do not use the literal placeholders below):

```bash
export JOB_ID='actual-uuid-from-POST-api-jobs'
read -s 'JOB_TOKEN?Job bearer token: '; echo; export JOB_TOKEN
curl -i -X POST "http://127.0.0.1:3000/api/jobs/$JOB_ID/analyze" \
  -H "Authorization: Bearer $JOB_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

The server responds with **202 Accepted** and an analysis status, usually `queued` or `processing` (it may finish extremely quickly). Then:

```bash
curl -s "http://127.0.0.1:3000/api/jobs/$JOB_ID/analysis" \
  -H "Authorization: Bearer $JOB_TOKEN"
curl -s "http://127.0.0.1:3000/api/jobs/$JOB_ID/steps" \
  -H "Authorization: Bearer $JOB_TOKEN"
```

`GET /steps` returns step text, screenshot captions, evidenceImageIds (screenshot jobs) or videoFrameIds and estimated timestamps (video jobs), and per-step `supportStatus`. All generated instructions require human review.

Job status changes `uploaded` → `processing` → `ready` or `failed`. If failed, the analysis `errorCode` provides a sanitized category; retry `POST .../analyze` after fixing input/configuration. It does not expose private model output or API errors.

## Critical scope and limitations

- Gemini sees actual screenshots or selected FFmpeg frames, **not the full continuous recording**. At most 24 chronological frames are sent for video, so short mouse clicks or unobserved intermediate states cannot be reconstructed reliably. Video boundary timestamps are approximations, not frame-exact detections.
- Images are re-encoded for AI inference only. Files used as document evidence are the unchanged normalized originals retained by M3/M4.
- Every returned evidence ID is validated against **that job and the subset sent to Gemini**; duplicate citations, reversed chronology and out-of-range timestamp estimates cause the run to fail rather than silently invent content.
- A model-generated `supported` judgment is **not independent evidence verification**. The optional second-pass inconsistency audit belongs in a later milestone.
- `responseJsonSchema` constrains Gemini output, but the backend also checks Zod shapes, ID ownership, chronology, and timestamp consistency.
- The current runner is an in-process background worker, persisted through SQLite; queued/running jobs are retried on process startup. For multi-server production deployment replace with a durable external queue and add explicit request rate limiting and cost budgets.
- User changes to job metadata after completed analysis are not automatically reflected in the stored steps (document editing is a later milestone).
- If video preprocessing is not ready, analysis returns 409; if the Gemini key is unset, 503. Existing job bearer-token access control is required for all new endpoints.

## Verification

Run `npm run check && npm test`. New `test/analysis.test.js` uses a mock analyzer ONLY in tests and generates real PNG pixels. No fake AI output is used in production. A real end-to-end Gemini call still needs to be performed on your Mac using your own API key.
