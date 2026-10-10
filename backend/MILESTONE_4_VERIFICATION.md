# Milestone 4 verification record

Execution environment: artifact container on 2026-10-10.

## Completed

- `npm run check`: passed production JavaScript syntax checks.
- `node --check` passed across all `.js` source and test files.
- OpenAPI 3.0.3 YAML loaded and video endpoints were present.
- SQLite migrations 1–4 executed in Python's sqlite3. A simulated existing v3 database upgraded to v4 while retaining the job access-token hash and job metadata.
- SQLite foreign-key constraints and video-frame cascading deletion passed direct SQL checks.
- ffprobe successfully inspected a real short generated MP4; ffmpeg extracted frames using the configured sampling/resize filter and protocol whitelist.
- Vitest test cases were authored for video upload, access-token isolation, invalid videos, chronological frame retrieval, deletion, and legacy v3 migration.

## Not run here

- Full `npm test` / Vitest and authenticated HTTP integration tests could not run because this execution environment has no installed dependencies and cannot reach the npm registry. Run these tests on the development MacBook after `npm install` and `brew install ffmpeg`.
- macOS ARM64 FFmpeg performance, MOV/WebM file examples, large video upload, restart recovery under actual process interruption, and full frontend integration have not been independently tested.

The system prepares chronological candidate frames but does **not** infer actual procedural step boundaries or generate captions at this milestone. That requires the Gemini analysis and separate verification features from subsequent milestones.
