# DocuAI — integrated Milestone 7 frontend and backend

This repository pairs the **uploaded React/Vite frontend** with the **Milestone 7 Express/SQLite backend**, including the tested Mac template-test fixture correction. Existing user database and uploaded evidence are **not bundled**.

## MacBook quick start (Node.js 22+, ffmpeg and ffprobe)

First, preserve any existing `backend/.env` and `backend/storage/` directory. If your Milestone 7 backend is already running and has 174 passing tests, **replace only its `frontend/` folder** with the integrated frontend. Do not replace your existing backend database or `.env`.

Terminal 1:

```bash
cd ~/Desktop/hackerdom/backend
# Only if you haven't already configured it: edit .env and set GEMINI_API_KEY.
# The model verified working with your project is gemini-3.5-flash.
# GEMINI_MODEL=gemini-3.5-flash
npm install
npm test
npm run dev
```

Terminal 2, in the folder adjacent to `backend/`:

```bash
cd ~/Desktop/hackerdom/frontend
npm ci
npm test
npm run build
npm run dev
```

Open **http://127.0.0.1:5173**. The Vite development server forwards `/api/*` to `http://127.0.0.1:3000`. The Gemini key belongs **only** in `backend/.env`. The frontend does not need a `.env` file when used with these defaults.

After installing dependencies separately inside `backend/` and `frontend/`, you can start both servers from the integrated repository root with `npm run dev` (press Control+C to stop).

To verify that the backend has the expected endpoints, run `node scripts/check-backend.mjs` from this repository root with the server running. It creates and deletes a temporary job; it doesn't invoke Gemini.

## End-to-end website workflow

1. Select document category and format.
2. Upload **one MP4/MOV/WebM video** (up to 80 MiB / 3 min / 4096 × 2160) **or** up to 12 PNG/JPEG/WebP screenshots (up to 5 MiB each).
3. Optionally add a process brief or plain TXT reference. Gemini analysis is enabled by default and requires a server-side key; disable it to view extracted evidence without a structured document.
4. Select the default template profile or upload a **custom DOCX** (up to 8 MiB). The backend validates the DOCX and inspects headings/styles.
5. Click **Generate document**. The frontend creates the private job, uploads evidence and optional template, waits for FFmpeg extraction if needed, triggers Gemini analysis, generates a persistent structured document and retrieves `/document/layout`.
6. In the editor, view numbered steps with their **actual selected private evidence frames** and a template heading-mapping preview. Edit the text and captions locally. Save a JSON draft or download an authenticated screenshots ZIP.

The private job access token is stored in sessionStorage (not printed, linked in image URLs, or included in downloaded drafts). Local editor changes persist in localStorage, **not** in the backend database yet.

## Supported backend contracts

- `POST /api/jobs` → `{job, accessToken}`
- `POST /api/jobs/:id/video` or `POST /api/jobs/:id/screenshots` → private evidence upload
- `GET /api/jobs/:id/video` or `GET /api/jobs/:id/screenshots` → extracted evidence
- `POST /api/jobs/:id/analyze` → analysis worker; `GET /analysis`, `GET /steps`
- `POST /api/jobs/:id/document` → persistent v6 draft
- `POST /api/jobs/:id/template` → private DOCX validation/storage
- `GET /api/jobs/:id/document/layout` → v7 style/heading mapping
- Authenticated `/video/frames/:frameId` or `/screenshots/:imageId` → private image bytes

## What is **not** implemented at Milestone 7

**DOCX/PDF export, exact Word template visual reproduction, backend storage of rich-text edits, independent evidence auditing, per-section AI regeneration, mixed video-plus-screenshots uploads, and server-side cancellation** are later milestones. The corresponding controls are disabled or accurately described; the site does not fake those operations. If Gemini fails, the evidence workspace remains usable but cannot be called a generated SOP.

## Verification

- Syntax/transpilation of all frontend TS/TSX sources and new tests: checked in packaging environment.
- Backend v7 test fixture (`analysisService` variable): corrected in the bundled source.
- **The frontend npm dependencies were not available in this packaging environment**, so local frontend Vitest, TypeScript semantic build, and live-browser smoke test still require running on your Mac. No passing claims are made for those checks here.
- Real Gemini analysis requires your valid API key, model, connection and live media; do not disclose tokens or provider keys.
