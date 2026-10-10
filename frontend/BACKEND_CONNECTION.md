# Connect to your friend's backend (Milestone 5)

Replace your old `frontend/` files with this ZIP's `frontend/` folder. Keep your friend's backend source, `.env`, and `storage/` intact. Do not copy the backend's Mac `node_modules/` to Windows; install dependencies on Windows instead. No backend source changes are required.

The frontend connects to `http://127.0.0.1:3000` by default. You do not need to create a frontend `.env` file for this connection. If you have an old frontend `.env` with `VITE_API_MODE=demo` or a port 8000 proxy, update those values using `.env.example` and restart the frontend.

## Windows: start both parts

Use Node.js 22.12 or newer. This connection was tested with Node 22.14. Ensure FFmpeg and ffprobe are installed and their `bin` folder is on Windows PATH. Restart the VS Code terminal after changing PATH.

Terminal 1, from the repository root:

```powershell
node --version
ffmpeg -version
ffprobe -version
cd backend
npm ci --ignore-scripts
npm run dev
```

For this exact supplied backend ZIP, `--ignore-scripts` avoids an unnecessary SQLite compilation attempt; its pinned better-sqlite3 13.0.3 and Sharp packages already contain compatible Windows binaries. This command and real extraction were verified on Windows x64. If your friend's repository has no `package-lock.json`, use `npm install --ignore-scripts`. Reassess that flag if backend dependencies change. Preserve the backend `.env`. If it does not exist, `Copy-Item .env.example .env` is optional for extraction; the default server runs on port 3000 and screenshots do not require a Gemini key. Put the Gemini key only in the backend `.env` when you want AI analysis.

Terminal 2, from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Choose a category, upload a recording, continue through context and the editable outline, then click **Prepare screenshots**. The editor displays the extracted images, timestamp captions, A4 pages, and editable notes. **Screenshots ZIP** downloads the original normalized PNG images returned by the backend. **Save draft** downloads the editable workspace as JSON.

For screenshots plus workflow instructions, enable **Analyse with Gemini** on the evidence screen. It is off by default. The backend must have a valid Gemini configuration. If AI analysis fails or has no key, the successfully extracted screenshots remain available, with a visible explanation. AI support is not an independent audit: independently checked counts stay at zero.

## Frontend tests and production build

```powershell
cd frontend
npm test
npm run build
```

To preview the production build against the local backend, configure `VITE_API_BASE_URL=http://127.0.0.1:3000` in a frontend `.env.local`, and set `CORS_ORIGINS=http://127.0.0.1:4173` in the backend environment, then restart the backend, rebuild the frontend and run `npm run preview`. Production hosting should use a reverse proxy for `/api` or set the backend origin before building. Vite's development proxy only runs during `npm run dev`.

If PowerShell blocks `npm.ps1`, use `npm.cmd` in the commands above.

## What is connected

1. `POST /api/jobs` sends strict `preferences` and `metadata`, then retains the returned job ID and private access token.
2. `POST /api/jobs/:id/video` uploads multipart field `video`. The frontend polls `GET /api/jobs/:id/video` until `processingStatus=ready`.
3. Frames load from `GET /api/jobs/:id/video/frames/:frameId` using the bearer token. Their actual order and `timestampMs` are preserved.
4. Alternatively, `POST /api/jobs/:id/screenshots` uploads ordered multipart fields `screenshots`, and `GET /api/jobs/:id/screenshots` lists the normalized images.
5. Optional AI analysis uses `POST /api/jobs/:id/analyze` with `{}`, polls `/analysis`, then reads `/steps`. Titles, instructions, explanations, expected results, captions, evidence IDs and timestamp ranges map to the editor. Unreferenced frames remain in the source screenshots section.

Tokens are stored in memory and sessionStorage, used only in Authorization headers, and never embedded in image URLs, the JSON draft, or the screenshot ZIP. A saved draft can reopen private images after a reload in the same browser session. After that session ends, the job's images require the private token; upload again to create a new accessible job. Download screenshots before ending the session if you need a portable image copy.

The development proxy removes the browser Origin header on the same-origin `/api` hop. Direct cross-origin deployments must configure the backend's CORS_ORIGINS explicitly. Private images are fetched with Authorization and rendered from temporary blob URLs; direct `<img>` API URLs cannot supply bearer headers.

## Current backend limits and missing features

- MP4, MOV or WebM; one video up to **80 MiB**, **180 seconds** and **4096 × 2160**. At most 60 sampled frames, with backend deduplication. The frontend checks available size/duration metadata; the backend remains authoritative for decoding and resolution.
- Or up to 12 PNG/JPEG/WebP screenshots, 5 MiB each. A job cannot combine video and screenshots.
- Plain brief and TXT reference text are combined into `metadata.additionalContext`, up to 8,000 characters. PDF/DOCX/image reference interpretation is absent.
- Backend document types are lab_report, tutorial, sop and user_manual. The nine frontend choices map to these nearest supported types. Personal uses the backend's professional tone because it has no personal-tone enum.
- The editable outline and notes remain local. This backend does not fill document templates or persist rich document edits.
- Custom DOCX parsing, per-section regeneration, independent auditing, Word/PDF export, chunked uploads, and a cancellation endpoint are absent. Their controls explain the limitation instead of issuing nonexistent API requests.
- **Stop waiting** aborts the browser wait/upload connection; it cannot cancel server work already accepted. **Retry with a new job** creates another job. **Check existing job** polls the accepted job after an extraction error/timeout; no automatic deletion occurs.
- The progress percentages represent workflow milestones, not an invented FFmpeg or Gemini percentage. Messages say when the backend provides no numeric progress.

No provider key, existing backend jobs/database, Mac dependencies, or backend source is included in the frontend ZIP.
