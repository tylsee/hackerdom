# Milestone 2 Verification

Verified on 2026-10-10 on macOS using managed Node.js 22.22.2, npm 10.9.7 and better-sqlite3 13.0.3.

## Results

- Milestone 1 baseline: **55 tests passed** before changes.
- Updated syntax checks: passed for app/server/config/database/migration/repository/service/schema/routes.
- Final `npm test -- --reporter=verbose`: **113 tests passed across 6 files**, with no failures or skips on this macOS run.
- `npm audit`: **0 known vulnerabilities reported** in the updated installed dependency graph at verification time. This does not guarantee absence of undisclosed/future vulnerabilities.
- SQLite native module loaded and executed real database queries on Node 22.22.2.
- Ten real curl checks against the actual production-configured entry point passed:
  1. Health: 200, backend version 0.2.0.
  2. Create academic lab-report job: 201.
  3. Create separate professional SOP job: 201.
  4. Retrieve first job using its token: 200, exact saved data.
  5. Retrieve without token: 401.
  6. Retrieve using the other job's token: 404.
  7. Invalid preferences: 400.
  8. Non-JSON creation request: 415.
  9. Allowed frontend origin and correct token: 200.
  10. Retrieve first job after full server-process shutdown/restart: 200 with identical preferences, metadata, timestamps and ID.
- Real process restart reused the same persistent SQLite file and original token. Both shutdowns exited 0.
- Newly created database permissions: 0600 on macOS; no tokens or private job IDs appeared in captured request logs.
- Exact README Step 6 (shell-variable token capture) and Step 7 (authenticated curl) blocks were executed successfully under zsh.
- Tests/manual verification used independent in-memory or temporary databases. No development database was erased or populated with test jobs. No test server is intentionally left running.

## Coverage

- Independent writingTone/documentType enums; all combinations supported.
- Optional metadata normalized to explicit nulls and empty objectives; provenance always user_supplied.
- Strict body schema, length limits, forbidden unknown properties, non-JSON/malformed/oversized/compressed input.
- Real prepared SQL writes, hash-only token storage, public response allowlist and token/metadata logging privacy.
- Missing/malformed bearer headers, query-token rejection, wrong/cross-job token isolation and safe absent-job responses.
- Atomic creation rollback on both preference and later metadata failures.
- Foreign keys and cascade semantics at the database layer (no deletion API implemented).
- Idempotent migrations, close/reopen persistence, full HTTP-listener restart persistence and bounded SQLite contention returning 503.
- Refusal of newer/unrelated/view-only/altered schemas and inconsistent migration history; migration DDL rollback after injected test failure.
- Owner-only existing-file permission requirement on POSIX; invalid DB paths and sanitized startup errors.
- Foundation regressions: health/headers, CORS, correlation IDs, safe errors, listener failure and clean/forced shutdown.

## Review changes

A read-only review identified schema acceptance and existing-file permission weaknesses. Initialization now refuses all unrelated schema objects, compares the exact supported version-1 schema before enabling WAL, and rejects existing POSIX DB files with group/other access instead of silently rewriting permissions. Regression tests cover these cases. Schema verification is explicitly version-specific and must be extended deliberately alongside future migrations.

## Limitations / additional testing

- No screenshot/video upload, Gemini, background processing, document generation/editing, templates, auditing or DOCX export implemented.
- No job listing/deletion/retention or metadata edit API yet.
- Capability tokens protect individual retrieval; account authentication, token expiry/recovery/rotation and public-create abuse controls are not implemented.
- SQLite data is not encrypted. Production TLS, backup/retention and operational readiness remain future work.
- Creation is not idempotent; a lost create response loses the only returned token, and retry creates a new job.
- Frontend UI integration, external deployment, teammate OS/native-binary compatibility and high-concurrency production load are not tested.
- /health remains process liveness, not dependency readiness.

## Instructions and delivery

README.md contains numbered steps for runtime selection, safe .env setup, test/start commands, token-capturing curl creation, authenticated retrieval, negative checks and actual restart persistence verification. openapi.yaml documents only implemented endpoints.

The source archive excludes .env secrets, job tokens, databases, node_modules and machine-specific dependency symlinks. Milestone 3 requires explicit user approval.
