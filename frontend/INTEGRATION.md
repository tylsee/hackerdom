# Current backend connection

The supplied Milestone 5 backend uses a separate adapter. Read [BACKEND_CONNECTION.md](BACKEND_CONNECTION.md). The original contract below is retained for a future full-document backend and requires VITE_BACKEND_PROFILE=document.

# Backend integration handoff

Only `frontend/` is delivered. The original project ZIP contains empty frontend/backend folders and a product README; there is no backend implementation to connect or modify.

`src/services/api.ts` is the single integration boundary. Set `VITE_API_MODE=live` to use real endpoints. The supplied section/figure/flag/validation JSON structure is retained, including unknown document fields. Figures accept an optional `fileUrl`, or look up `frameId` in an optional document-level `frames` array. Without URLs, the UI renders an explicit frame placeholder rather than inventing evidence.

## Implemented endpoints

| Method | Path                                     | Frontend request / expected response                                                         |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/api/uploads`                           | Multipart upload; `{ fileId }`                                                               |
| POST   | `/api/jobs`                              | Category, docType, videoFileId, imageFileIds, briefText, briefFileIds, template; `{ jobId }` |
| GET    | `/api/jobs/:id`                          | `{ status, stage, progress, message }`                                                       |
| GET    | `/api/jobs/:id/result`                   | Document JSON from supplied contract                                                         |
| POST   | `/api/jobs/:id/cancel`                   | `{}`; success JSON or HTTP 204                                                               |
| POST   | `/api/templates/parse`                   | Multipart `file`; `{ sections: string[] }` or mapping objects                                |
| POST   | `/api/jobs/:id/sections/:sid/regenerate` | `{ section }`; complete or partial section with `html`                                       |
| POST   | `/api/jobs/:id/export`                   | `{ sections, title, meta }` with the current edited sections; `{ docxUrl, pdfUrl, zipUrl? }` |

Requests include cookies (`credentials: include`) and have 60-second HTTP timeouts. Uploads have a 120-second timeout per request. Polling runs approximately every 900ms. Three minutes without progress produces a recoverable state with **Check existing job**, **Retry generation** and **Cancel generation**. Retrying cancels the previous known job before starting another. Cancellation failures are displayed and do not claim that the backend job was stopped.

Job status values: `queued`, `processing`, `completed`, `failed`, `cancelled`. Progress is a number from 0 to 100. Stage numbers are **zero-based 0–4** in the order shown in the UI. Named stages beginning with `analyse`, `extract`, `identify`, `write`, or `verify` are recognised; unknown stage names use progress to estimate the active stage. Align exact naming with your backend before production.

## Upload protocol: explicit assumption to confirm

The supplied contract defines the endpoint and final `fileId`, but does not specify the multipart/chunk schema. This frontend proposes:

- Up to 100 MiB: one multipart field named `file`.
- Above 100 MiB: 10 MiB binary chunks posted sequentially to the same endpoint. Multipart fields: `file`, `uploadId` (UUID shared by all chunks), `chunkIndex` (zero-based), `totalChunks`, `filename`.
- The final response must include `fileId`. Intermediate chunk responses may be `{}`.
- Each chunk retries twice after its first attempt. The backend must make `(uploadId, chunkIndex)` idempotent to avoid duplicate writes.
- This is byte transport only. The frontend never divides a recording into video segments or extracts frames. The backend reassembles bytes before processing and owns all timeline segmentation.

Confirm this protocol or change `upload()` in `src/services/api.ts` to match your backend or signed-object-storage workflow. No hard client size/duration cap is imposed; the backend should return actionable errors for deployment-specific limits. Accepted extension checks are a frontend convenience; the backend must verify MIME/content and size.

## Fields needing agreement

- Built-in template: `{ type: "builtin", sections }`. Custom: `{ type: "custom", fileId, mapping, sections }`, where mapping entries are `{ heading, section, confidence }`. `sections` is an optional array of user-approved heading strings carried forward from the brief/reference step and editable in Template. Confirm backend support for this additional field. Parsing returns heading strings or objects with those properties.
- TXT reference headings and explicitly formatted headings in the brief can be previewed locally. DOCX reference headings use `/api/templates/parse` in live mode. PDF and image references are carried forward by filename and file ID for backend interpretation; the UI does not claim that their text was read in demo mode.
- A4 sheets are a frontend editing layout. Continuation fragments merge back into the original section's HTML before regeneration/export. The backend remains responsible for the final DOCX/PDF typesetting; page counts may differ in exported files.
- Extraction preferences are sent as an **optional extension** named `extractionSettings`, containing `captureOnChange`, `dedupe`, `splitLongVideos`, `flagSensitiveData`. The original contract does not define this field. Implement or adapt it on the backend; the frontend labels these as requested preferences and does not perform those operations itself.
- Section regeneration receives the current section, never the entire document. It replaces section text after explicit user confirmation. The stable original section ID is preserved.
- Export receives sections with edited HTML and captions. The optional `userEdited` boolean supports UI attribution; ignore it for typesetting. Title and metadata are sent as optional export fields alongside `sections`, so frontend title edits can update the exported cover page. The original contract only specifies sections; confirm backend support for these additional fields.
- Download URLs must be HTTP(S) or relative same-origin URLs. Cross-origin download endpoints should use `Content-Disposition: attachment` and have suitable CORS/auth behaviour.
- Sample flag values and backend flag values are displayed verbatim. A review flag stays visible when a user edits the associated text; editing does not silently change verification status.

## Remaining backend tasks

1. Implement/authenticate the listed endpoints and configure the dev proxy or production reverse proxy/CORS.
2. Confirm chunk schema, idempotency and final assembly; provide server-side file/content validation and any size limits.
3. Implement frame extraction, deduplication, ordering, sensitive data detection, category-specific authoring and evidence verification.
4. Parse real DOCX headings and apply the edited mapping to generated sections.
5. Return accessible frame image URLs and the document JSON, including `missing[]` and validation counts.
6. Implement cancellation, errors, partial results and section regeneration using stable IDs.
7. Generate DOCX/PDF from current edited sections and return real download URLs. Test the exported typography against the editor preview.
8. If needed, confirm document title/meta export fields and a dedicated autosave endpoint. Browser autosave is currently local only.

There are no AI API keys, account system, server-side document conversion, evidence-pack UI, or deployment changes in this frontend. Evidence-pack export was removed from the product specification and is intentionally omitted.
