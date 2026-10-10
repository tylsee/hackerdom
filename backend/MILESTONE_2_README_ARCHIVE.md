> **Updated Milestone 2:** This edition adds input type selection, authenticated PATCH/DELETE, expanded status constraints, and a versioned v1-to-v2 migration. Historical WorkBuddy verification statistics in `VERIFICATION.md` cover the *original* package only. See `FIX_VERIFICATION.md` for validation performed on this edition.

# DocuAI Backend — Milestone 2

Backend-only implementation of **DocuAI — Do It Once. Document It Automatically.**

Milestone 1 remains intact. Milestone 2 adds **real SQLite persistence**, automatic migrations, job creation/retrieval, separate documentation preferences, user-supplied metadata and per-job access tokens. No frontend, uploads, AI calls, document generation or export is implemented yet.

## 1. What changed and why

- **SQLite / better-sqlite3 13.0.3:** local persistent storage, no separate database server or cloud activation.
- **Three related tables:** `jobs`, `job_preferences`, `job_metadata`; foreign keys and transactional writes prevent partially saved jobs.
- **Versioned migrations:** a fourth table, `schema_migrations`, records migration history; `PRAGMA user_version` records the current schema version (2). Existing compatible databases are reused, not reset.
- **Private jobs:** creation returns a random 256-bit bearer capability token once. Only its SHA-256 hash is saved. Reading another job requires that job's token, not just its UUID.
- **Explicit provenance:** metadata is always `source: "user_supplied"`, not visually verified evidence. Tone and document type are separate fields.
- **Minimal API refinement:** creation is public for this local prototype, retrieval is token-protected. This addresses the original private-job requirement without inventing a user-account system. No other major architecture change.

`status: "created"` means the job is saved, not yet uploaded or analyzed. The database now supports `created`, `uploaded`, `processing`, `ready`, and `failed` for future processing workers. Public clients cannot set the status.

## 2. Relevant files

```text
backend/
  package.json / package-lock.json  Pinned runtime/test dependencies; version 0.2.0
  .env.example                    Configuration without real secrets
  .gitignore                      Excludes .env, storage, SQLite files and node_modules
  README.md                       Numbered setup/API instructions
  openapi.yaml                    Implemented API contract
  VERIFICATION.md                 Test results and limitations
  src/
    app.js                        Middleware, health and jobs route composition
    server.js                     Open/migrate DB, bind HTTP, close DB on shutdown/failure
    config/env.js                 dotenv + Zod, backend-relative database path
    db/database.js                Restrictive new-file permissions and SQLite pragmas
    db/migrations.js              Append-only, transactional schema migrations
    models/job-repository.js      Prepared queries, atomic writes, public DTO allowlist
    schemas/job.js                Strict job request schema
    services/job-service.js       UUIDs, token hashing, validation and authorization
    routes/jobs.js                POST /api/jobs and token-protected GET/PATCH/DELETE /api/jobs/:id
    routes/health.js               GET/HEAD /health (liveness only)
    middleware/                   Error sanitization, JSON limits, safe correlation logs
    utils/                        Safe AppError and structured logger
    workers/                      Reserved; no background processing yet
  test/
    app.test.js                   Foundation regressions
    env.test.js                    Configuration and database-path validation
    logger.test.js                 Secret-safe logging
    server.test.js                 Real entry point, ports and clean/forced shutdown
    jobs.test.js                   Creation, enums, validation, tokens and isolation
    database.test.js               Persistence, migrations, rollback, FK and lock failures
```

Runtime: Node.js 22.12+; verified on **Node 22.22.2 / npm 10.9.7**. Existing Express 5, dotenv, Zod, Helmet, CORS, Vitest and Supertest are retained. New dependency: **better-sqlite3 13.0.3**. No Gemini key, FFmpeg or Office software is needed.

## 3. Step-by-step: run on this machine

### Step 1 — Select the verified runtime and backend

Terminal 1:

```bash
export PATH="/Users/tyralee/.workbuddy-ai/binaries/node/versions/22.22.2-6/bin:$PATH"
cd "/Users/tyralee/WorkBuddy AI/DocuAI_2/backend"
node --version
npm --version
```

Expected Node: `v22.22.2`. Dependencies have already been installed in the isolated runtime workspace. The existing, git-ignored `backend/node_modules` symlink points there; no global npm packages were installed.

### Step 2 — Configure without overwriting an existing .env

```bash
test -e .env || cp .env.example .env
```

If `.env` already exists from milestone 1, do not overwrite it: optionally add/edit these settings manually. Missing settings use the defaults shown:

```dotenv
DATABASE_PATH=storage/docuai.sqlite
DATABASE_BUSY_TIMEOUT_MS=5000
HOST=127.0.0.1
PORT=3000
```

Relative database paths always resolve from `backend/`, **not** the shell directory. Default file:

`/Users/tyralee/WorkBuddy AI/DocuAI_2/backend/storage/docuai.sqlite`

Do not point this at an unrelated or important existing database. The application refuses unrecognized or newer schemas. Process environment values take precedence over `.env`.

### Step 3 — Run checks

```bash
npm run check
npm test
```

Tests use independent in-memory/temporary SQLite databases. They do not wipe or modify your default development database. See `VERIFICATION.md` for final counts and real-HTTP results.

### Step 4 — Start the server

```bash
npm run dev
```

For a non-watch process use `npm start`. Startup creates the database directory/file if missing, applies migrations automatically and then binds the HTTP listener. No manual SQL setup is required. Default URL: `http://127.0.0.1:3000`.

Stop with **Ctrl+C**; wait for `server_stopped`. Never delete your SQLite files to restart the server. If port 3000 is busy, use `PORT=3001 npm start` and adjust the curl URL accordingly.

## 4. Step-by-step: create, retrieve and verify persistence

Terminal 2:

### Step 5 — Check liveness

```bash
export PATH="/Users/tyralee/.workbuddy-ai/binaries/node/versions/22.22.2-6/bin:$PATH"
BASE_URL="http://127.0.0.1:3000"
curl -i "$BASE_URL/health"
```

Expected: **200**, `status: "ok"`, `version: "0.2.0"`. Health is process liveness, not a database/Gemini readiness claim.

### Step 6 — Create a documentation job

```bash
CREATE_RESPONSE=$(curl --silent --show-error --fail-with-body \
  -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" \
  --data '{
    "preferences": {
      "writingTone": "academic",
      "documentType": "lab_report"
    },
    "metadata": {
      "title": "Software installation practical",
      "processDescription": "Document the completed installation workflow",
      "intendedAudience": "Students",
      "objectives": ["Record the observed installation steps"],
      "additionalContext": "User-provided context, not verified visual evidence",
      "specialRequirements": "Do not invent commands or results"
    }
  }')

JOB_ID=$(CREATE_RESPONSE="$CREATE_RESPONSE" node --input-type=module -e \
  'const r=JSON.parse(process.env.CREATE_RESPONSE); if(!r.job?.id) process.exit(1); console.log(r.job.id);')
JOB_TOKEN=$(CREATE_RESPONSE="$CREATE_RESPONSE" node --input-type=module -e \
  'const r=JSON.parse(process.env.CREATE_RESPONSE); if(!r.accessToken) process.exit(1); console.log(r.accessToken);')
```

Expected creation status: **201**. The response contains `{ "job": {...}, "accessToken": "..." }`; `Location` is `/api/jobs/<uuid>` and `Cache-Control` is `no-store`. The commands capture the response and token in shell variables rather than deliberately printing the token.

**Keep the job ID and token privately.** The token is returned only at creation; it is never retrievable again and cannot currently be recovered or rotated. Anyone with the token and job ID can access that job. Do not commit it, put it in URLs, send it in screenshots or share it in logs. Use HTTPS when this backend is externally hosted.

Minimal alternative input is just:

```json
{
  "preferences": { "writingTone": "professional", "documentType": "sop" }
}
```

### Step 7 — Retrieve using the matching token

```bash
curl -i "$BASE_URL/api/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JOB_TOKEN"
```

Expected: **200**, `{ "job": {...} }`, matching saved preferences/metadata. There is no `accessToken`, token hash or internal storage path in the read response.

### Step 8 — Check access-control and validation failures

```bash
# Expected 401 UNAUTHORIZED: UUID alone is insufficient
curl -i "$BASE_URL/api/jobs/$JOB_ID"

# Expected 400 VALIDATION_ERROR: writing tone is an exact enum
curl -i -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" \
  --data '{"preferences":{"writingTone":"casual","documentType":"sop"}}'

# Expected 400 INVALID_JSON
curl -i -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" --data '{"broken":'

# Expected 415 UNSUPPORTED_MEDIA_TYPE
curl -i -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: text/plain" --data 'not JSON'
```

A syntactically valid token for another job returns **404 `JOB_NOT_FOUND`**, the same as an unknown UUID with a well-formed token. Tokens in query parameters are not accepted. Automated tests verify cross-job isolation.

### Step 9 — Verify persistence across an actual server restart

1. Leave Terminal 2 open so `JOB_ID` and `JOB_TOKEN` remain set.
2. In Terminal 1, stop with Ctrl+C and wait for shutdown.
3. In Terminal 1, run `npm start` again **with the same DATABASE_PATH**.
4. In Terminal 2, rerun Step 7. Expect **200 with the same job data**.

A lost token does not erase the job, but it prevents retrieval. Closing Terminal 2 loses its shell variables; use an appropriate private secret store if you need longer-term access. Do not write tokens into project source.

## 5. Exact API contract

### POST /api/jobs — 201

Public local-prototype creation endpoint. Requires `Content-Type: application/json`.

Strict body schema:

| Field | Required | Accepted values / limit |
| --- | --- | --- |
| `preferences` | yes | Object; unknown fields rejected |
| `preferences.writingTone` | yes | `academic`, `professional` |
| `preferences.documentType` | yes | `sop`, `user_manual`, `tutorial`, `lab_report` |
| `preferences.inputType` | no | `screenshots` (default), `video` |
| `metadata` | no | Object; defaults to normalized empty metadata |
| `metadata.title` | no | Trimmed text, 1–200 characters, or null |
| `metadata.processDescription` | no | Trimmed text, 1–4000 characters, or null |
| `metadata.intendedAudience` | no | Trimmed text, 1–500 characters, or null |
| `metadata.objectives` | no | Array of up to 20 trimmed nonempty strings, max 500 characters each; defaults to [] |
| `metadata.additionalContext` | no | Trimmed text, 1–8000 characters, or null |
| `metadata.specialRequirements` | no | Trimmed text, 1–4000 characters, or null |

Unknown properties are rejected at every object level. `status`, `source`, IDs, tokens and timestamps are server-controlled; the caller cannot set them. Whitespace-only text is rejected, not treated as useful context. All combinations of tone and document type are supported independently.

### GET /api/jobs/:id — 200

Requires `Authorization: Bearer <matching-job-token>`. Response shape:

```json
{
  "job": {
    "id": "server-generated-uuid",
    "status": "created",
    "createdAt": "ISO-8601 timestamp",
    "updatedAt": "ISO-8601 timestamp",
    "preferences": { "writingTone": "academic", "documentType": "lab_report", "inputType": "screenshots" },
    "metadata": {
      "title": "Software installation practical",
      "processDescription": null,
      "intendedAudience": null,
      "objectives": [],
      "additionalContext": null,
      "specialRequirements": null,
      "source": "user_supplied"
    }
  }
}
```

IDs are UUIDs. With well-formed authorization, a malformed ID returns 400. Missing/malformed authorization returns 401 before ID validation. Wrong/cross-job tokens and unknown valid IDs return an identical 404 response. GET does not mutate timestamps or create records. HEAD works through Express GET routing and also requires the token.

### PATCH /api/jobs/:id — 200

Requires the matching `Authorization: Bearer <token>` header and JSON body. Submit only the changed fields, for example:

```bash
curl -i -X PATCH "$BASE_URL/api/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"preferences":{"inputType":"video"},"metadata":{"title":"Updated workflow"}}'
```

A nonempty `preferences` or `metadata` object is required. Unspecified fields are retained;
nullable text fields may be set to `null` and `objectives` may be set to `[]`. Unknown fields,
client-authored `status`, or invalid input types are rejected with 400. Processing jobs
cannot be reconfigured (409) until processing finishes. No raw tokens are included in responses.

### DELETE /api/jobs/:id — 204

```bash
curl -i -X DELETE "$BASE_URL/api/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JOB_TOKEN"
```

A matching token is required. A successful deletion removes `jobs`, `job_preferences`, and
`job_metadata` records via foreign-key cascades, and returns no body. Repeated deletes or
wrong tokens return 404, and processing jobs return 409. Future milestones must add file
cleanup when screenshot/video storage is implemented; there are no media files yet.

### Version 2 database migration and statuses

The original v1 migration was **not modified**. Version 2 transactionally rebuilds the jobs
table to expand its `status` CHECK, adds `input_type` to `job_preferences`, and backfills
existing jobs with `input_type = screenshots`. It preserves job IDs, token hashes, metadata,
creation/updated timestamps and migration history. Startup validates the version-specific
schema before migration and validates foreign-key integrity afterwards. It refuses unexpected
schemas or future versions rather than resetting the database. **Back up your existing database
before first upgrade; do not delete it or manually change the version.**

Allowed internal status transitions: `created → uploaded → processing → ready/failed` (and `created/uploaded → failed`).
The system can retry `failed → processing`. These transitions are implemented in the
repository for later workflow services, not exposed as a client-controlled HTTP endpoint.

### Errors

All JSON errors retain `{ "error": { "code", "message", "requestId" } }`. No input values, arbitrary unknown-key names, SQL, token hashes, stack traces or internal paths are reflected.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid preferences/metadata or unknown fields |
| 400 | `INVALID_JOB_ID` | Malformed UUID with well-formed authorization |
| 400 | `INVALID_JSON` / `INVALID_REQUEST_BODY` | Invalid JSON or incomplete body |
| 401 | `UNAUTHORIZED` | Missing/malformed job bearer token; includes WWW-Authenticate |
| 403 | `CORS_ORIGIN_DENIED` | Origin header not in the configured allowlist |
| 404 | `JOB_NOT_FOUND` | Unknown job or wrong/cross-job token |
| 404 | `NOT_FOUND` | Unimplemented route or method |
| 413 | `PAYLOAD_TOO_LARGE` | JSON byte limit exceeded |
| 415 | `UNSUPPORTED_MEDIA_TYPE` / `UNSUPPORTED_ENCODING` | Non-JSON creation request or unsupported/compressed encoding |
| 409 | `JOB_PROCESSING` | Update or deletion is prohibited while job is processing |
| 503 | `DATABASE_BUSY` | SQLite contention exceeded configured wait; no partial write |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected failure, sanitized |

Creation has no idempotency key yet. If a client loses a successful create response, the token is unrecoverable; retrying creates a new job. Do not automatically retry an ambiguous POST as though it were idempotent. A failed transactional write does not leave partial rows.

## 6. Configuration and database lifecycle

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `HOST` | `127.0.0.1` | Local-only by default |
| `PORT` | `3000` | 1–65535; invalid/occupied ports fail startup |
| `DATABASE_PATH` | `storage/docuai.sqlite` | Relative to backend, or absolute; `:memory:` for isolated tests/dev only |
| `DATABASE_BUSY_TIMEOUT_MS` | `5000` | 0–30000; wait for SQLite locks |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `JSON_BODY_LIMIT_BYTES` | `65536` | 1024–1048576; not future multipart limits |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | 100–120000 |
| `CORS_ORIGINS` | empty | Comma-separated exact HTTP(S) origins |

Production rejects `DATABASE_PATH=:memory:` so persistent storage cannot silently become temporary. Newly created DB files use mode 0600 and newly created directories use 0700 on POSIX; existing file permissions are not rewritten, and POSIX files accessible to group/other users are refused. If a known DocuAI database has overly broad permissions, back it up securely, stop all writers and deliberately restrict it to owner-only access before retrying. SQLite uses WAL, foreign keys, a bounded busy timeout and `synchronous=FULL`. Local storage is **not encrypted**; protect the host, database and backups appropriately.

Both migration SQL and job writes run in transactions. Startup refuses a newer, unrelated, damaged or incompatible schema instead of resetting it. The database closes after HTTP shutdown and on listener failures. Configuration/native/file/SQL errors fail startup with safe diagnostics such as `DATABASE_INIT_FAILED`; they do not pretend persistence succeeded.

WAL may use `docuai.sqlite-wal` and `docuai.sqlite-shm` sidecars. **Do not delete or copy only the main file while the server is running.** For a manual development backup, stop the server cleanly and copy the database and any remaining sidecars to a secure backup location. Automated backups and retention are not implemented yet.

## 7. Frontend integration contract (no frontend code)

For an allowed frontend origin, configure before startup:

```bash
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173" npm start
```

The frontend creates a job using the strict JSON above, privately retains `job.id` and `accessToken`, and sends that token via the `Authorization` header on retrieval. `X-Request-Id` and `Location` response headers are exposed to allowed origins. Cookies and wildcard CORS are not enabled. A 204 preflight is not proof that a particular route exists.

CORS is not authentication. An unlisted Origin receives 403; origin-less curl calls are allowed but still need the job token for retrieval. Creating jobs is currently public and not rate-limited. Account authentication, token rotation/recovery/expiry, abuse controls and deployment TLS must be addressed before public production exposure.

## 8. Teammate clean install / native dependency troubleshooting

Extract `outputs/docuai-backend-milestone-2.zip`. The portable archive includes source, tests, docs and lockfile; it excludes `.env`, tokens, database files, node_modules and machine-specific symlinks.

From the extracted backend directory with Node 22.22.2 selected:

```bash
npm ci
npm run check
npm test
test -e .env || cp .env.example .env
npm start
```

`better-sqlite3` is a native module. If no suitable prebuilt binary is available on a teammate's OS/architecture, npm needs that platform's compiler/build prerequisites (macOS Command Line Tools; Linux C/C++ build tools; Windows supported C++ build tools) and a compatible Python. Do not switch Node major versions without reinstalling dependencies. The installed native module is verified against the managed Node 22.22.2 runtime, not the machine's unrelated system Node.

For a normal clean setup, run `npm ci`, `npm run check`, `npm test`, then `npm start` from this `backend/` directory. This package does not depend on WorkBuddy-specific paths or symlinks.

## 9. What is deliberately not implemented

Job listing, screenshot/video file uploads, upload ordering, frame extraction, Gemini, durable queues, document generation/editing, templates, auditing and DOCX export. Input selection is now persisted; no file is uploaded yet. Future job deletion must be extended to delete stored media. No fake production data or AI responses are returned. A user chooses the evidence input path when real upload support is implemented later.

Manual frontend integration, deployment, teammate OS compatibility and high-concurrency production load remain untested. SQLite is appropriate for the local hackathon backend, not claimed as a horizontally scaled production database. Tokens provide per-job capability access, not registered-user authentication or encrypted storage.

**Stop after Milestone 2. Screenshot uploads (Milestone 3) require explicit approval.**
