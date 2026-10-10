# DocuAI

**Turn recorded workflows into evidence-linked documentation.**

DocuAI combines a React frontend with a Node.js backend to extract screenshots from screen recordings, analyse workflows with Gemini, and present the results in an editable A4 document workspace.

The current implementation supports real video frame extraction, screenshot uploads, optional AI workflow analysis, rich-text editing, local draft persistence, and screenshot ZIP downloads.

## Features

- Education, Work, and Personal document categories.
- Video uploads with backend screenshot extraction using FFmpeg.
- Screenshot uploads as an alternative to video.
- Optional Gemini analysis that returns instructions, explanations, expected results, captions, and evidence references.
- Editable document outlines with section addition, renaming, and deletion.
- A4 document pages with page navigation and page counters.
- Rich-text editing, including fonts, formatting, alignment, and lists.
- Editable document titles and screenshot captions.
- Authenticated access to private evidence images.
- Downloadable ZIP archives containing extracted PNG screenshots.
- Local draft autosave, draft restoration, and JSON downloads.
- Responsive desktop and mobile layouts.
- Interactive water-colour background, headline animations, and reduced-motion support.

## Technology Stack

| Component                 | Technologies            |
| ------------------------- | ----------------------- |
| Frontend                  | React, TypeScript, Vite |
| Document editor           | Tiptap                  |
| Interface icons           | Lucide React            |
| HTML sanitisation         | DOMPurify               |
| Screenshot ZIP generation | fflate                  |
| Backend                   | Node.js, Express        |
| Database                  | SQLite, better-sqlite3  |
| Upload handling           | Multer                  |
| Image processing          | Sharp                   |
| Video processing          | FFmpeg, ffprobe         |
| Workflow analysis         | Google Gemini           |
| Validation                | Zod                     |
| Frontend testing          | Vitest, Testing Library |

## Project Structure

```text
hackerdom/
├── frontend/
│   ├── public/
│   │   └── assets/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── services/
│   │   └── utils/
│   ├── tests/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   ├── BACKEND_CONNECTION.md
│   └── QA_REPORT.md
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── utils/
│   ├── scripts/
│   ├── test/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── openapi.yaml
└── README.md
```

Each application’s `package.json` must be directly inside its respective folder. Avoid nested paths such as `frontend/frontend/` or `backend/backend/`.

## Prerequisites

- **Node.js 22.12 or newer** and npm.
- **FFmpeg and ffprobe**, available on the system PATH.
- **VS Code** or another code editor.
- A modern browser.
- A Gemini API key for optional AI analysis.

Screenshot extraction does **not** require a Gemini API key.

### Verify Installed Tools

Open a PowerShell terminal and run:

```powershell
node --version
npm.cmd --version
ffmpeg -version
ffprobe -version
```

Node.js is available from the [official download page](https://nodejs.org/en/download).

On Windows, FFmpeg can be installed using Windows Package Manager:

```powershell
winget install --id Gyan.FFmpeg --exact --source winget
```

Alternatively, use the Windows builds linked from the [official FFmpeg download page](https://ffmpeg.org/download.html) and add the extracted `bin` directory to PATH.

Restart VS Code after installing tools or changing PATH.

## Installation and Local Development

Open the project’s root folder in VS Code. Run the backend and frontend in **two separate terminals**.

### 1. Start the Backend

From the project root:

```powershell
cd backend
npm.cmd ci --ignore-scripts
npm.cmd run dev
```

For the supplied backend dependency versions, `--ignore-scripts` avoids an unnecessary SQLite compilation attempt and uses the included compatible Windows binaries. This installation was verified on Windows x64.

If `package-lock.json` is unavailable, install using:

```powershell
npm.cmd install --ignore-scripts
```

The backend runs at:

```text
http://127.0.0.1:3000
```

Check server availability at:

```text
http://127.0.0.1:3000/health
```

Keep the backend terminal running.

### 2. Start the Frontend

Open a second terminal at the project root:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open the application at:

```text
http://127.0.0.1:5173/
```

Keep both terminals running while using the application.

### 3. Stop the Application

Press **Ctrl+C** in each terminal.

### Subsequent Runs

Dependencies only need to be installed initially or when dependency files change.

Backend terminal, from the project root:

```powershell
cd backend
npm.cmd run dev
```

Frontend terminal, from the project root:

```powershell
cd frontend
npm.cmd run dev
```

## Environment Configuration

### Frontend

The connected frontend defaults to the Milestone 5 backend on port 3000. A frontend `.env` file is optional for the default local setup.

To customise the connection, create `.env` from `.env.example` if it does not already exist:

```powershell
cd frontend
if (!(Test-Path .env)) {
    Copy-Item .env.example .env
}
```

Use:

```dotenv
VITE_API_MODE=live
VITE_BACKEND_PROFILE=milestone5
VITE_API_BASE_URL=
API_PROXY_TARGET=http://127.0.0.1:3000
```

| Variable               | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `VITE_API_MODE`        | Selects `live` backend operation or `demo` mode.                               |
| `VITE_BACKEND_PROFILE` | Selects the current `milestone5` adapter or the future `document` API adapter. |
| `VITE_API_BASE_URL`    | Backend origin for direct requests. Leave empty to use the development proxy.  |
| `API_PROXY_TARGET`     | Backend address used by Vite’s development proxy.                              |

Restart the frontend after changing environment settings. Check existing `.env.local` files for conflicting values.

**Never place API keys or other secrets in frontend environment variables.**

### Backend

The backend defaults support screenshot extraction without a `.env` file.

To configure optional Gemini analysis, create `.env` only if it does not already exist:

```powershell
cd backend
if (!(Test-Path .env)) {
    Copy-Item .env.example .env
}
```

Relevant settings include:

```dotenv
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=storage/docuai.sqlite
CORS_ORIGINS=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

Set `GEMINI_API_KEY` to a valid key and use a model supported by the configured account. Preserve an existing verified model configuration where applicable.

Restart the backend after changing its environment settings.

## Application Workflow

1. **Select a category**  
   Choose Education, Work, or Personal and a document type.

2. **Upload evidence**  
   Add one recording or a collection of screenshots.

3. **Choose optional AI analysis**  
   Enable **Analyse with Gemini** to request workflow instructions. Leave it disabled for screenshot extraction only.

4. **Provide context**  
   Enter a brief or attach TXT reference files.

5. **Review the outline**  
   Add, rename, or remove local document sections.

6. **Prepare screenshots**  
   The frontend creates a private backend job, uploads the evidence, and waits for processing.

7. **Review and edit**  
   Inspect screenshots, review available AI steps, and edit the A4 workspace.

8. **Download results**  
   Use **Screenshots ZIP** for PNG images or **Save draft** for a JSON document backup.

If optional AI analysis fails, successfully extracted screenshots remain available with an explanation.

## Supported Inputs

| Input                   | Current Backend Limit                               |
| ----------------------- | --------------------------------------------------- |
| Video formats           | MP4, MOV, WebM                                      |
| Videos per job          | One                                                 |
| Video size              | Up to 80 MiB                                        |
| Video duration          | Up to 180 seconds                                   |
| Video resolution        | Up to 4096 × 2160                                   |
| Sampled video frames    | Up to 60 before backend selection and deduplication |
| Screenshot formats      | PNG, JPEG, WebP                                     |
| Screenshots per job     | Up to 12                                            |
| Screenshot size         | Up to 5 MiB each                                    |
| Context                 | Plain-text brief and TXT references                 |
| Combined context length | Up to 8,000 characters                              |

A job accepts **video or screenshots**. Mixed video-and-screenshot jobs are not supported by the current backend.

## Backend Integration

The frontend uses the following endpoints:

| Method | Endpoint                              | Purpose                                        |
| ------ | ------------------------------------- | ---------------------------------------------- |
| `GET`  | `/health`                             | Check backend availability.                    |
| `POST` | `/api/jobs`                           | Create a private job.                          |
| `GET`  | `/api/jobs/:id`                       | Retrieve job information.                      |
| `POST` | `/api/jobs/:id/video`                 | Upload a recording.                            |
| `GET`  | `/api/jobs/:id/video`                 | Retrieve extraction status and frame metadata. |
| `GET`  | `/api/jobs/:id/video/frames/:frameId` | Retrieve a private extracted PNG frame.        |
| `POST` | `/api/jobs/:id/screenshots`           | Upload screenshot evidence.                    |
| `GET`  | `/api/jobs/:id/screenshots`           | List screenshot evidence.                      |
| `GET`  | `/api/jobs/:id/screenshots/:imageId`  | Retrieve a private screenshot.                 |
| `POST` | `/api/jobs/:id/analyze`               | Start optional Gemini analysis.                |
| `GET`  | `/api/jobs/:id/analysis`              | Retrieve analysis status.                      |
| `GET`  | `/api/jobs/:id/steps`                 | Retrieve evidence-linked workflow steps.       |

Job creation returns a job ID and access token. Protected requests use:

```http
Authorization: Bearer <access-token>
```

Private images are fetched with this header and displayed using temporary browser object URLs.

See `backend/openapi.yaml` and `frontend/BACKEND_CONNECTION.md` for additional integration details.

## Data Storage and Security

- Backend job records are stored in SQLite.
- Uploaded evidence is stored privately under `backend/storage/`.
- Evidence endpoints require the corresponding job access token.
- The frontend retains access tokens in memory and browser session storage.
- Tokens are excluded from screenshot download URLs, screenshot ZIP archives, and JSON drafts.
- Document edits are saved locally in the browser.
- Backend-provided HTML is sanitised before editing or rendering.
- Provider keys belong exclusively in `backend/.env`.

Do not commit `.env`, `node_modules/`, or backend storage data to GitHub.

Private images can reopen after a reload within the same browser session. After the session ends, image access requires the job token. Download the screenshots ZIP for a portable copy of the evidence.

## Demo Mode

To run the frontend without backend processing, set:

```dotenv
VITE_API_MODE=demo
```

Restart the frontend after changing this setting.

Demo mode uses prewritten sample documents and simulated processing. It does not analyse uploaded files or produce real AI results.

## Testing and Build

### Frontend Tests

From `frontend/`:

```powershell
npm.cmd test
```

### Frontend Production Build

From `frontend/`:

```powershell
npm.cmd run build
```

Build output is generated in:

```text
frontend/dist/
```

### Backend Checks

From `backend/`:

```powershell
npm.cmd run check
npm.cmd test
```

The backend commands are provided for development verification. The frontend integration report does not claim that the complete backend test suite was executed.

### Production Preview

Vite’s development proxy is available during `npm run dev`; it is not a production reverse proxy.

For local production preview against the backend:

1. Set `VITE_API_BASE_URL=http://127.0.0.1:3000` in the frontend environment.
2. Add `http://127.0.0.1:4173` to backend `CORS_ORIGINS`.
3. Restart the backend.
4. Rebuild and preview the frontend:

```powershell
npm.cmd run build
npm.cmd run preview
```

Open:

```text
http://127.0.0.1:4173/
```

For deployment, configure a production backend origin or serve `/api` through a reverse proxy.

## Current Implementation Limits

The current backend supports evidence extraction and workflow analysis. The following features remain pending:

- Automatic composition of complete documents from templates.
- Custom DOCX template parsing.
- PDF, DOCX, and image reference interpretation.
- Backend persistence of rich document edits.
- Per-section AI regeneration.
- Independent evidence auditing.
- Word and PDF export.
- Mixed video-and-screenshot jobs.
- Resumable or chunked uploads.
- A backend cancellation endpoint.

The editable outline and document notes remain local. AI evidence support is not an independent verification result.

**Stop waiting** stops the browser’s request or polling; it does not cancel work already accepted by the backend. Retrying with a new job creates another backend job.

## Verification Summary

The connected frontend was verified with:

- **32 passing frontend tests**.
- A successful TypeScript check and Vite production build.
- Real extraction of the supplied Excel recording, producing **11 screenshots**.
- Authenticated screenshot display and PNG ZIP download.
- Local draft restoration.
- Desktop and mobile layout checks.
- Optional-analysis failure handling when no Gemini key is configured.
- Mapping of the supplied five-step analysis response using automated tests and controlled browser responses.

A live Gemini provider call was not performed during integration verification. Backend source files were not modified.

## Troubleshooting

| Problem                                      | Resolution                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `package.json` is not found                  | Check the terminal’s current folder. Run commands inside the relevant `frontend` or `backend` directory. |
| Frontend shows **Demo workspace**            | Set `VITE_API_MODE=live`, use the `milestone5` profile, and restart the frontend.                        |
| Frontend cannot reach the backend            | Start the backend and check `http://127.0.0.1:3000/health`.                                              |
| FFmpeg or ffprobe is not recognised          | Install the tools, add their `bin` directory to PATH, and restart VS Code.                               |
| SQLite installation requests C++ build tools | For the supplied backend dependencies, use `npm.cmd ci --ignore-scripts`.                                |
| Video upload is rejected                     | Check the recording’s format, size, duration, and resolution.                                            |
| Gemini analysis is unavailable               | Configure the backend key and model, or disable AI analysis to use screenshot extraction only.           |
| A port is already in use                     | Stop the existing server or use the terminal already running it.                                         |
| Private images cannot reopen                 | Restore within the same browser session, use a downloaded screenshots ZIP, or upload the evidence again. |

## Additional Documentation

- `frontend/BACKEND_CONNECTION.md` — setup, endpoint mapping, and backend limits.
- `frontend/QA_REPORT.md` — frontend verification details.
- `frontend/INTEGRATION.md` — the original future full-document API contract.
- `backend/README.md` — backend implementation documentation.
- `backend/openapi.yaml` — backend API schemas.
