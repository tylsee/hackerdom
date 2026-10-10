# Milestone 7 integration verification

The frontend is wired to `/api/jobs`, video/screenshots, Gemini `/analyze` and `/steps`, document generation `/document`, and template `/template` and `/document/layout` endpoints. The integration includes a mocked full-flow test (`tests/milestone7-integration.test.ts`), selected-image ownership validation, updated Word/PDF limitation messages, and a backend API smoke-check script in `scripts/`.

**Run on the target Mac:** `cd frontend && npm ci && npm test && npm run build`. Run `node scripts/check-backend.mjs` from the integrated repository root with the v0.7.0 backend running. The build and full Vitest suite are **not claimed to have passed in this environment** because npm was unable to obtain required dependencies.

Backend Milestone 7 package is provided with the known `test/template.test.js` `analysisService` setup error corrected; the user's existing Mac backend already passed 174 tests in the conversation.

Not supported: live document export, independent audit, persistent backend edits, arbitrary long videos. Consult the root README.
