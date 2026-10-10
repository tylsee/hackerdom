# DocuAI Backend — Milestone 5: Gemini AI Workflow Analysis

Backend-only application. Includes **Milestone 1** (Express, validation, error handling), **Milestone 2** (SQLite jobs, per-job tokens, editing and deleting jobs), and **Milestone 3** (real screenshot upload, validation, private storage, chronological order and image retrieval). **Milestone 4 adds MP4/MOV/WebM upload and FFmpeg processing. Milestone 5 adds Gemini analysis of uploaded screenshots or sampled video frames, persisted evidence-linked steps, captions, and estimated video timestamps. Document templates, independent audits and DOCX export are NOT implemented yet.**

## Requirements

- Node.js **22.12+** (Node 22 LTS recommended).
- npm and internet connectivity for your **first** dependency installation.
- The upload APIs run without a Gemini key, but real AI analysis requires a Gemini API key. Video processing also requires `ffmpeg` and `ffprobe` (macOS: `brew install ffmpeg`).

## Install and start

```bash
cd backend
npm install
# Milestone 5 adds @google/genai; npm install updates the package-lock.json.
# After first install, commit the newly generated package-lock.json with package.json.
npm run check
npm test
cp -n .env.example .env  # optional; do not overwrite existing settings
npm run dev
```

**Important:** The ZIP intentionally omits `package-lock.json` because Milestone 5 adds `@google/genai` and this environment cannot access the npm registry. Run **`npm install`**, not `npm ci`, on the first run of this edition. Once npm writes the new lockfile, use `npm ci` on clean installs. If you are updating your existing backend in place, replace package.json and run `npm install` to update your existing lockfile.

Default API: `http://127.0.0.1:3000`; health endpoint: `GET /health`.

`.env.example` contains supported config. By default, private SQLite data is in `backend/storage/docuai.sqlite`, and uploaded screenshots are in `backend/storage/uploads/<job-id>/<image-id>.png`. Files are never served using a public static-directory mount. They require an authorized API request.

**Backup before migrating:** stop the backend and copy your existing SQLite database (and any WAL/SHM files if present) to a private location. The application uses append-only migrations through v5; existing job IDs, tokens and data are retained. Do not overwrite `storage/` with the contents of this ZIP.

## Milestone 5 — AI workflow

See **[MILESTONE_5.md](./MILESTONE_5.md)** for API calls, Gemini configuration, and limitations.

## Milestone 4 video workflow

See **[MILESTONE_4.md](./MILESTONE_4.md)** for setup, authenticated video upload, FFmpeg extraction status polling, private frame retrieval, video deletion, and limitations.

## End-to-end screenshot API example

All endpoints below return JSON except the private PNG-image retrieval. `POST /api/jobs` returns an `accessToken` **once**. Save it securely; use it only in the `Authorization: Bearer` header. Do **not** put it in URLs, logs or source control.

### 1. Create a screenshot job

```bash
curl -s -X POST http://127.0.0.1:3000/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"preferences":{"writingTone":"academic","documentType":"lab_report","inputType":"screenshots"},"metadata":{"title":"Excel Workflow"}}'
```

Example shape:

```json
{"job":{"id":"UUID","status":"created","preferences":{"writingTone":"academic","documentType":"lab_report","inputType":"screenshots"}},"accessToken":"TOKEN"}
```

Use the **real** `id` and `accessToken` from your response:

```bash
export JOB_ID='paste-real-uuid'
export JOB_TOKEN='paste-real-access-token'
```

### 2. Upload screenshots in chronological order

```bash
curl -i -X POST "http://127.0.0.1:3000/api/jobs/$JOB_ID/screenshots" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  -F 'screenshots=@/absolute/path/01.png' \
  -F 'screenshots=@/absolute/path/02.png'
```

**File part order is chronological order**. The backend does not infer order from filenames. A successful upload returns HTTP 201, the `status: "uploaded"`, and an ordered `screenshots` array. New uploads append to the existing sequence.

For the hackathon MVP, a job supports **at most 12 screenshots total**, each at most **5 MiB** before image processing. Accepted formats: **PNG, JPEG, WebP**. Each file is decoded by Sharp, checked for validity and size (25 million pixel limit), reoriented, stripped of metadata and normalized to PNG (20 MiB post-processing limit). Uploaded raw temp files are removed.

### 3. List or view private evidence

```bash
curl -s "http://127.0.0.1:3000/api/jobs/$JOB_ID/screenshots" \
  -H "Authorization: Bearer $JOB_TOKEN"

export IMAGE_ID='paste-an-image-id'
curl -L "http://127.0.0.1:3000/api/jobs/$JOB_ID/screenshots/$IMAGE_ID" \
  -H "Authorization: Bearer $JOB_TOKEN" --output evidence.png
```

Screenshot fields: `id`, `order` (1-based), `mimeType`, `byteSize`, `width`, `height`, `sha256`, `createdAt`. Server filesystem paths and secrets are **never** returned. The image endpoint emits the actual PNG bytes, not a base64 JSON representation.

### 4. Rearrange screenshots explicitly

```bash
curl -i -X PATCH "http://127.0.0.1:3000/api/jobs/$JOB_ID/screenshots/order" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"imageIds":["second-image-uuid","first-image-uuid"]}'
```

Provide **all existing** image IDs exactly once. Missing, duplicate or foreign image IDs return HTTP 400 and do not modify the stored order. Reordering updates SQLite atomically and does not rename files.

### 5. Remove screenshot or job

```bash
curl -i -X DELETE "http://127.0.0.1:3000/api/jobs/$JOB_ID/screenshots/$IMAGE_ID" \
  -H "Authorization: Bearer $JOB_TOKEN"

curl -i -X DELETE "http://127.0.0.1:3000/api/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JOB_TOKEN"
```

Deleting a screenshot renumbers remaining evidence 1..N; deleting the final screenshot returns job status to `created`. Deleting the entire job cascades its SQLite evidence records and removes its local screenshot directory. Jobs in the `processing`, `ready` or `failed` state do not allow screenshot changes. Video jobs cannot receive screenshots. A job with uploaded evidence cannot switch `inputType` from screenshots to video.

## Implementation and security

- `src/db/migrations.js`: append-only SQLite schema versions 1 through **5**.
- `src/models/screenshot-repository.js`: SQL transactions for insert, reorder and delete.
- `src/services/screenshot-service.js`: real Sharp validation and normalization, private files.
- `src/routes/screenshots.js`: Multer multipart limits, bearer auth, HTTP routes.
- `src/middleware/job-auth.js`: bearer-token parsing used across jobs and evidence.
- `test/screenshots.test.js`: real image upload, ordering, authorization, deletion, invalid formats, limits and file cleanup.
- `openapi.yaml`: REST API contract for frontend integration.

Client-supplied filenames are never used as storage paths. Storage filenames are generated UUIDs, and `storage/` is gitignored. Private job access uses unguessable per-job bearer tokens, with only hashes stored in SQLite; this is a **single-machine hackathon model**, not a full account-based access-control system. Screenshots can contain sensitive information; only submit materials you are permitted to process.

The server accepts multipart uploads for screenshot/video routes and JSON for job creation, editing, and analysis. These have separate size limits. A request timeout of 240 seconds is configured for video uploads. The implementation uses disk-backed Multer temporary files, not unbounded in-memory multipart bodies.

### Known limitations

- Upload to filesystem + SQLite is best-effort coordinated, not a distributed atomic transaction. Unexpected disk I/O errors or crashes may leave orphaned files that require maintenance cleanup.
- Local screenshot storage is not a shared/object store. Multiple hosts/replicas require a different storage backend and a worker/queue design.
- The screenshot collection is a deliberately small hackathon prototype. It does not implement thumbnails, duplicate detection, antivirus scanning, user accounts, quotas across jobs, or resumable large uploads.
- **Template filling, independent auditing, document editing and Word export are not implemented yet.** Gemini analysis is implemented, but a live provider call still needs local verification with a valid API key.
- Tests execute with real SQLite and real Sharp image processing, not fake production outputs. Live verification requires installing the npm packages on your machine.

## Testing

```bash
npm run check
npm test
```

See `openapi.yaml` for specific endpoint schemas. See `MILESTONE_2_README_ARCHIVE.md` for the earlier implementation notes. Historical test reports predate this milestone and must not be represented as proof that this version's tests passed.

**Next:** Milestone 6 adds structured document composition for academic/professional layouts, followed by templates, editing, optional audits and DOCX export.
