# DocuAI — Frontend / Backend Split

> **One rule:** the frontend owns *how people use it*; the backend owns *how the document gets made*.  
> The frontend never calls an AI model, never extracts frames, never builds a `.docx`.  
> The backend never touches UI state or styling.  
> The two sides talk through **one JSON contract**. Freeze that contract first and both of you can work in parallel.

---

## 0. Product shape (so you know what you are building)

Three categories, chosen on the very first screen. They share **one pipeline** — they only differ in  
prompt set, section template and voice.

| Category      | Voice                | Built-in template | Example doc types                   |
| ------------- | -------------------- | ----------------- | ----------------------------------- |
| **Education** | Academic, passive    | Report template   | Lab report, Tutorial, Assignment    |
| **Work**      | Imperative, formal   | SOP template      | SOP, Training manual, Process guide |
| **Personal**  | Warm, plain language | Recipe template   | Recipe, How-to guide, Care guide    |

> Do **not** build a separate pipeline per category. Three prompt sets + three section templates.  
> That is the whole difference.

Hard rules that apply to every category:

- The recording may have **no captions, no narration, no subtitles**. The AI must read what is **on screen**.
- Videos can be **any length**. Long ones are split into segments and stitched back by timestamp.
- Anything the AI cannot see clearly is marked `unverified`. **It never invents a step.** This is the product's core promise.

Flow is a strict wizard: **Evidence → Context → Template → Generate → Editor**. You cannot reach step N before finishing N-1.

---

## 1. Frontend (you)

### Wizard & state

- Screen 0: three category cards + doc-type chips inside each card + a looping intro video  
  (`intro.mp4`, muted, autoplay, loop — a 15–25s screen recording of the whole workflow)
- Four-step wizard with a stepper at the top; step gating (no Continue until the step is satisfied)
- Category badge stays visible the whole time — it silently decides voice, sections and figure rules

### Uploads

- **Three upload areas**, each doing one job:
  1. video (and screenshots for steps the video missed)
  2. brief — typed text **or** uploaded files, `DOCX · PDF · TXT · PNG · JPG` (photos of a printed rubric must work)
  3. template — built-in or your own
- Drag & drop, click-to-browse, file list, per-file remove; validate type and size on the client
- **Read the video duration on the client**: `URL.createObjectURL` → `<video preload="metadata">` → `duration`.  
  Show "≈N frames kept / M segments" straight away so a 40-minute upload does not look frozen
- Chunked upload above ~100 MB, with progress and retry

### While generating

- Poll `GET /api/jobs/:id` (or SSE) and render the 5 stages
- Rotating tips while waiting, plus Cancel → `POST /api/jobs/:id/cancel`

### Editor (the biggest piece)

- `contenteditable` body + Word-like toolbar: font, size, B/I/U, strikethrough, 4 alignments,  
  bullet/numbered lists, undo/redo, and **download buttons sitting in the toolbar**: `Word`, `PDF`, `Evidence`
- Clickable table of contents generated from `h2`/`h3`, scroll-to on click, active section highlighted on scroll
- Right-hand evidence panel: steps, figures, verified count, flagged count; clicking a flag jumps to the  
  highlighted text in the body and flashes it
- AI-uncertain text is visually distinct (yellow background, dotted underline) from text the user wrote
- "Re-generate" per paragraph → `POST /api/jobs/:id/sections/:sid/regenerate`
- Autosave draft, show `Saving… → All changes saved`

### Explicitly NOT frontend

- Any AI / VLM call
- Frame extraction, dedupe, OCR
- Producing or parsing `.docx`

---

## 2. Backend (your friend)

### Ingestion

- `POST /api/uploads` chunked upload or direct-to-object-storage, returns `fileId`
- Normalise video to H.264/AAC so odd encodings do not break extraction

### Frame extraction (the step that decides whether this product works)

- **Scene-change detection, not uniform sampling**  
  `ffmpeg -i in.mp4 -filter:v "select='gt(scene,0.25)',showinfo" -vsync vfr f_%04d.png`  
  Threshold must adapt to video length — too low and steps are missed, too high and you get frame floods
- **dHash / pHash dedupe** — drop frames within Hamming distance < 5
- **Long videos**: split into segments, extract in parallel, then **merge by timestamp into one timeline**.  
  Get this wrong and the step order is wrong
- Output `frames[]`: `frameId`, `timestamp`, `fileUrl`, `dhash`

### Understanding & authoring

- VLM per frame (or per batch) → `Process_Steps.json`: step boundaries, titles, action text, frame ranges
- Three prompt sets, one per category:
  - `education` → academic passive, `Figure N:` captions, in-text cross-references, TOC, list of figures
  - `work` → `Step 01`, imperative, checkpoints, WARNING/CAUTION, version block, revision table
  - `personal` → warm plain language, ingredients/materials before method, tips in the user's own words
- If a brief or rubric was uploaded: extract the requirement list, generate against it, and report  
  anything missing in `missing[]`
- **If it cannot be seen, mark it `unverified`. Never invent.** This is what judges will remember

### Templates

- `POST /api/templates/parse` — read the heading outline of an uploaded `.docx`, return `sections[]`  
  so the frontend can show the mapping step. The frontend sends the mapping back.

### Assembly & export

- Build `.docx` with python-docx: figure numbering, captions, cross-reference fields (or plain text),  
  TOC field, header/footer, version block
- PDF via LibreOffice headless
- **Evidence pack** (`.zip`): every kept frame, the annotated versions, `steps.json`  
  (which step came from which frame) and the validation report
- Sensitive-data detection (regex + visual heuristic); hits go into `flags[]`

### Jobs & reliability

- Task queue (Celery / BullMQ) + `GET /api/jobs/:id` returning stage and percentage
- One bad frame must not kill the run — degrade that step to `unverified`
- Timeouts: return partial progress for long videos; never let the frontend spin with nothing

---

## 3. API contract — freeze this and both of you can start

| Method | Path                                     | Purpose                                                                                                 |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| POST   | `/api/uploads`                           | chunked upload → `{ fileId }`                                                                           |
| POST   | `/api/jobs`                              | `{ category, docType, videoFileId, imageFileIds[], briefText, briefFileIds[], template }` → `{ jobId }` |
| GET    | `/api/jobs/:id`                          | `{ status, stage, progress, message }`                                                                  |
| GET    | `/api/jobs/:id/result`                   | document JSON (below)                                                                                   |
| POST   | `/api/jobs/:id/cancel`                   | cancel                                                                                                  |
| POST   | `/api/templates/parse`                   | upload docx → `{ sections[] }`                                                                          |
| POST   | `/api/jobs/:id/sections/:sid/regenerate` | regenerate one section                                                                                  |
| POST   | `/api/jobs/:id/export`                   | edited sections → `{ docxUrl, pdfUrl, zipUrl }`                                                         |

### Document JSON — `GET /api/jobs/:id/result`

```json
{
  "category": "education",
  "docType": "Lab report",
  "title": "Determination of the Spring Constant using Hooke's Law",
  "meta": { "course": "PHY 2104", "date": "2026-10-10" },
  "sections": [
    {
      "id": "s-proc",
      "heading": "3.0 Procedure",
      "html": "<p>The retort stand was assembled…</p>",
      "blocks": [
        {
          "type": "figure",
          "id": "fig-1",
          "frameId": "f_0041",
          "caption": "Experimental setup showing the spring suspended…",
          "checkpoint": null,
          "annotated": true
        }
      ],
      "flags": [
        {
          "id": "fl-1",
          "level": "unverified",
          "text": "The transition between 250 g and 300 g was not clearly captured.",
          "frames": ["f_0047", "f_0052"]
        }
      ]
    }
  ],
  "validation": { "steps": 8, "figures": 8, "verified": 6, "flagged": 2 },
  "missing": []
}
```

The frontend renders exactly this. When the user edits, send the same structure back to  
`POST /api/jobs/:id/export` and the backend re-typesets it.

---

## 4. Three boundaries that always cause arguments — settle them now

**① Who builds the `.docx`?**  
→ **Backend.** The frontend edits an HTML preview; on export it posts the sections JSON and the backend  
rebuilds with python-docx. Captions, cross-reference fields and TOC fields are only reliable from the  
backend library; a frontend `docx.js` build loses formatting.  
Cost: what you see will not be pixel-identical to what you get. So have the backend return a PDF preview  
for the frontend to show beside the editor.

**② Who handles long videos?**  
→ Backend splits, parallelises and stitches **by timestamp**. The frontend must not slice the video  
itself — slicing on the client loses the timeline and the step order breaks.

**③ What is the unit of write-back after editing?**  
→ The **section**, never the whole document. If the user changed `3.0 Procedure`, only `s-proc` goes back.  
Then "regenerate one section" and "export" reuse the same structure, and figure numbering cannot drift.

---

## 5. Suggested milestones

| Stage                           | Goal                                                        | Output                                   |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| **M0 — freeze the contract**    | Decide the JSON above together                              | a `contract.json`, then work in parallel |
| **M1 — frontend, fully mocked** | Wizard + editor running on fake JSON, demo-ready UI         | current `index.html`                     |
| **M2 — backend, thinnest path** | mp4 → dedupe → VLM → steps JSON → docx                      | one command that runs end to end         |
| **M3 — wire them up**           | Replace mock data with real job state and real export       | end-to-end deliverable                   |
| **M4 — polish**                 | Long-video splitting, template mapping, sensitive data, PDF | hackathon demo build                     |

**Demo tip:** keep the M1 mock frontend. If the network dies on stage you still have a complete interface to  
talk through — and judges understand a complete experience far better than a working endpoint.
