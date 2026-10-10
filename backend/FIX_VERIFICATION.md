# DocuAI Milestone 2 — Fix verification

Updated 2026-10-10 from the uploaded `docuai-backend-milestone-2.zip`.

## Implemented

- `inputType`: `screenshots` or `video`, defaulting to `screenshots` for older clients and historical jobs.
- `PATCH /api/jobs/:id`: authenticated partial preference/metadata updates, with strict Zod validation and transactional SQLite writes.
- `DELETE /api/jobs/:id`: authenticated deletion (HTTP 204) with SQLite child-table cascades.
- Versioned schema migration **v2**: expanded job status constraint and input-type column without changing the released v1 migration.
- Repository-only status transition operation; job status cannot be edited through public PATCH.
- OpenAPI contract, README and regression tests updated.

## Validation completed in this environment

- `npm run check` passed: all backend source JS parses under Node.js 22.16.0.
- `node --check test/*.js` passed: all six original and additional test source files parse.
- `openapi.yaml` parsed successfully with PyYAML; paths GET/HEAD/PATCH/DELETE for `/api/jobs/{id}` are present.
- Executed both migration SQL blocks on a real SQLite 3.46.1 engine with a pre-populated v1 database:
  - Preserved the job ID, stored token hash and child metadata/preferences.
  - Backfilled `input_type = screenshots`.
  - Verified `PRAGMA foreign_key_check` returned zero violations.
  - Verified invalid `status` values failed the CHECK constraint.
  - Verified deleting the parent cascaded to both child tables.

## Not independently executed here

The complete Vitest/Supertest suite and native `better-sqlite3` JavaScript integration cannot run in this environment: the required npm tarballs are not cached, and npm registry access was unavailable. The original `VERIFICATION.md` reflects WorkBuddy's **prior** tests, not these fixes. Additional tests are included in `test/jobs.test.js` and `test/database.test.js`, but their results must be confirmed on your Mac.

## Run on your computer

```bash
cd backend
npm ci
npm run check
npm test
npm start
```

Save a backup of any existing `storage/docuai.sqlite` (and SQLite WAL sidecars as appropriate) before the first upgrade. Do not delete or edit a database manually to make the tests pass. Future media uploads will need file cleanup integrated into job deletion.
