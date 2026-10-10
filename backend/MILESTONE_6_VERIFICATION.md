# Milestone 6 — Verification record

Verification was performed in the packaging environment, **not on the user's Mac**.

- `npm run check`: **passed** (all listed application JavaScript files have valid syntax).
- `find test src -name '*.js' ... node --check`: **passed** (all tests and source JavaScript syntax).
- `openapi.yaml` parsed successfully using Python PyYAML; version 0.6.0 and the draft endpoint are present.
- Migration v1 through v6 DDL was replayed using Python sqlite3: the new `document_drafts` table was created, and `PRAGMA foreign_key_check` returned no problems.
- A new `test/document.test.js` covers screenshot and video drafting, authorization, deterministic evidence selection, snapshot preservation, regeneration, review flags, migration from v5, and job deletion cascade.
- **Full Vitest suite was not run here.** The archive has no `node_modules`, and `npm install --offline` failed because the local npm cache lacks the official Gemini SDK. Run `npm test` on a Mac that has the Milestone 5 dependencies installed. Do not interpret this record as proof all runtime tests pass.
- No live Gemini call was made during packaging. Milestone 6 builds from existing saved analysis, not a new provider request.

## Installation / rollback precautions

This package must not overwrite local `.env`, `storage/`, or `node_modules/`. Before upgrading, stop the server and back up the database with WAL/SHM files if present. Versioned migration 6 preserves data; older Milestone 5 code will refuse to open an already upgraded v6 database. Restore both the old code and the pre-upgrade database backup to roll back.
