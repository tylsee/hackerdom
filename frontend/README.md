# DocuAI frontend — integrated with backend Milestone 7

This is the original supplied React/Vite/TypeScript frontend, updated to consume the existing DocuAI v0.7.0 private job, media, Gemini, document, and DOCX template APIs.

## Quick start on Mac

```bash
# Backend in a separate terminal (~/Desktop/hackerdom/backend):
# npm run dev
cd ~/Desktop/hackerdom/frontend
npm ci
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:5173`.

By default, Vite proxies `/api` requests to port 3000. The frontend does **not** need an API key; configure `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash` only in backend `.env`. If older frontend `.env` or `.env.local` files exist, remove the obsolete `VITE_BACKEND_PROFILE=document`, `VITE_API_MODE=demo`, or port 8000 settings. See `.env.example` and the repository-root README.

## Working through Milestone 7

- Private creation of jobs and bearer-token uploads of screenshots or short videos.
- FFmpeg extraction status and authenticated evidence image rendering.
- Evidence-based Gemini analysis, validation and step generation.
- SQLite-backed document composition via `POST /document`.
- Optional custom DOCX template upload and preview of server-detected heading/style matches.
- Editable rich-text draft, captions, local save and restore, JSON backup, screenshots ZIP.

## Not yet available

DOCX/PDF export, exact Word layout, backend-persisted edits, per-section regeneration and independent audit are later milestones. Buttons requiring these features are disabled with explanatory text; the generated document is currently a structured draft rather than a downloadable Word file.

## Test

```bash
npm test
npm run build
```

The packaging environment could not install npm dependencies. Run these locally before treating this release as verified for your Mac. You can also run `node scripts/check-backend.mjs` from the repository root to check the M7 backend endpoints.


## Word (.docx) download

On the document editor, click **Word**. The browser creates a real editable
`.docx` file containing the current edited text, procedure headings, captions,
review notices, and embedded private images. Evidence images are loaded using
the original job's bearer token, and export stops with an error if any required
image is unavailable. The browser does not send files to a third-party export
service. Screenshots remain private.

**Limitations:** PDF export is still disabled. Custom Word template heading
mappings inform paragraph levels, but exact original template formatting,
headers, footers and page breaks are not reproduced. This initial exporter uses
a clean built-in Word style set. Rich-text features such as hyperlinks, tables
and arbitrary CSS may be flattened; verify the downloaded DOCX in Word before
sharing. Export operates on locally edited content; server-side edit persistence
is not included.
