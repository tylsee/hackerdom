# Milestone 3 validation record

Environment: project artifact generation container, 2026-10-10.

## Completed here

- `npm run check`: passed (Node syntax verification for all production modules).
- `node --check` for every JavaScript source and test file: passed.
- OpenAPI 3.0.3 YAML parsed successfully; all six API paths present.
- Database v1, v2 and v3 SQL scripts executed in local SQLite through Python's sqlite3 module.
- SQLite screenshot order staging, reordering, foreign-key integrity, and ON DELETE CASCADE were exercised successfully using the v3 schema.
- Existing migrations 1 and 2 are unchanged; migration 3 was appended.

## Not completed here

- `npm test` cannot execute: npm dependencies (including `vitest`, `multer` and `sharp`) are not installed in this container.
- Registry `npmjs.org` is unreachable from the artifact environment (DNS EAI_AGAIN), so a dependency lockfile cannot be correctly regenerated here.
- Real HTTP multipart handling, actual Sharp decoding and integration tests require running `npm install && npm test` on the user's computer.

The ZIP omits the old `package-lock.json` rather than distributing a known-inconsistent lockfile. The old Milestone 2 lockfile is archived as `MILESTONE_2_package-lock.reference.json`. On first installation run `npm install`, then commit the newly generated `package-lock.json` before use of `npm ci` in deployment/CI.

## Minimum local acceptance checks

```bash
npm install
npm run check
npm test
npm run dev
```

The new `test/screenshots.test.js` tests uploads, metadata and PNG bytes, chronological order, reorder/rollback validation, cross-job isolation, invalid media, limits, evidence deletion, job deletion, and job status gating. The `test/database.test.js` suite also covers v2 -> v3 database upgrade preserving existing jobs.

**Do not claim the end-to-end tests passed until they have actually run on the developer's machine.**
