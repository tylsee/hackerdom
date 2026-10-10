# DocuAI frontend

React, Vite and TypeScript frontend with a real connection to your friend's supplied Milestone 5 backend. No backend source files are modified or included. Copy this ZIP's `frontend/` folder into your existing repository, replacing the previous frontend files.

Read [BACKEND_CONNECTION.md](BACKEND_CONNECTION.md) for the exact two-terminal Windows setup, backend installation workaround, FFmpeg requirements, endpoint mapping and feature limits.

## Quick start on Windows

Terminal 1 from the repository root (Node 22.12+ and FFmpeg/ffprobe on PATH):

```powershell
cd backend
npm ci --ignore-scripts
npm run dev
```

This backend installation flag is specific to the supplied pinned dependencies. Their Windows binaries were verified; a normal install unnecessarily attempted SQLite compilation here. Keep your friend's existing `.env` and `storage/`.

Terminal 2 from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. No frontend `.env` is required: live Milestone 5 mode and a port 3000 proxy are the defaults. If you already created an old `.env`, replace its frontend connection settings using `.env.example`. Never copy a Gemini key into the frontend.

```powershell
# In frontend/:
npm test
npm run build
```

If PowerShell blocks npm.ps1, use npm.cmd. For production preview with a running backend, see the connection guide's API-origin/CORS instructions.

## Working features

- Compact category, evidence, context and outline screens; desktop and mobile layouts.
- Mouse-following water colours, ripples, floating headline and reduced-motion support.
- Real private backend jobs, video uploads, FFmpeg frame polling and authenticated screenshot retrieval.
- Screenshot uploads as an alternative to video; validation matches the backend's supported limits.
- Optional Gemini analysis with evidence-linked instructions and captions. Off by default; screenshot extraction does not require an AI key. Analysis errors preserve the extracted screenshots.
- Source screenshots shown first when AI analysis is off, chronological captions and timestamp references.
- Actual PNG screenshot ZIP download. Private bearer tokens are excluded from downloads and URLs.
- Plain brief/TXT context; editable local outline with pencil, delete and add controls.
- A4 editor pages, live page counter, font styles, paragraph alignment, lists, title/caption editing and mobile contents/evidence drawers.
- Local draft autosave/restore and JSON backup. Private images can reload in the same browser session; download the screenshot ZIP for portable copies.
- Full-opacity supplied scene.mp4 processing background without a white overlay.

The backend does not yet compose documents, parse DOCX templates, audit steps independently, regenerate sections or export Word/PDF. The frontend explains these limits. Extracted screenshots never claim to be analysed or verified. Stop waiting affects the browser only; there is no backend cancellation endpoint.

## Other modes

Create `.env` from `.env.example` only when you need different settings:

```dotenv
VITE_API_MODE=demo
```

Demo runs locally with prewritten samples and simulated progress. It does not analyse uploads.

The original future full-document API is retained behind `VITE_API_MODE=live` and `VITE_BACKEND_PROFILE=document`; its contract is in INTEGRATION.md. Do not select that profile for your friend's current backend.

## Delivery contents

All source, configuration, lockfile, tests and required local assets are included. node_modules, dist, backend data, provider keys and private environment files are excluded. Extract into your repository root to create frontend/; avoid frontend/frontend/.
