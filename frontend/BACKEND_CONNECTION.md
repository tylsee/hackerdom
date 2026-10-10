# Backend connection — Milestone 7

`frontend/src/services/milestone.ts` is the v7 adapter. Use `VITE_API_MODE=live` and `VITE_BACKEND_PROFILE=milestone7` (the defaults); `VITE_BACKEND_PROFILE=document` refers to a separate unimplemented future API and **must not** be used with this backend.

The frontend Vite proxy forwards `/api` to `127.0.0.1:3000`, avoiding browser cross-origin configuration in local development. In a production deployment, use an HTTPS reverse proxy for `/api` or configure the frontend API base and backend exact CORS origins.

### Request order

1. `POST /api/jobs` with `preferences` (`inputType`, `documentType`, `writingTone`) and `metadata` (processDescription, additionalContext, title). Store `accessToken` privately.
2. `POST /api/jobs/:id/template` (optional), multipart field `template`.
3. `POST /api/jobs/:id/video` (field `video`) or `/screenshots` (field `screenshots`). Poll until extracted images ready.
4. `POST /api/jobs/:id/analyze` then poll `GET /api/jobs/:id/analysis`; `GET /steps` retrieves validated AI steps.
5. `POST /api/jobs/:id/document` creates/preserves the structured document; `GET /api/jobs/:id/document/layout` returns template mapping.
6. Private image bytes load via Authorization headers and temporary browser blob URLs. The token is not added to the URL.

The template heading list is **not** editable through the current backend API: selecting the file merely sends it to the authoritative DOCX parser after the job is created. The returned mapping is a presentation plan, not a guarantee of exact Word fidelity.

If AI analysis fails, the frontend presents source evidence instead of inventing a procedure. An existing job can be rechecked in the processing view. Cancellation stops the browser wait, not an accepted server worker. Word/PDF export is not available at Milestone 7.
