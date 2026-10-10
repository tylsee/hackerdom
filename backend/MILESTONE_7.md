# DocuAI Milestone 7 — Private DOCX template integration

This milestone is **template upload and mapping**, not finished Word export.

## Features

- One original Word `.docx` template per job. Maximum 8 MiB, uploaded as a bearer-authenticated `multipart/form-data` field named `template`.
- Safe read-only inspection of DOCX ZIP parts, rejects invalid/encrypted/macro-containing documents, includes decompression limits.
- Extracts Word `Title`, `Heading1`, `Heading2` and `Normal` style IDs, plus actual heading text with associated style/level when present.
- Private storage at random server-controlled locations, SQLite migration version 7 for metadata, SHA-256 and profile. Previous job records, analysis and drafts are preserved.
- Default profile used automatically if no Word template is uploaded.
- Non-destructive layout plan maps familiar template headings to generated document sections. Unmatched headings are reported but never filled with fabricated content. This is **not a pixel-identical renderer**.
- Replacing/deleting an uploaded template updates the presentation plan immediately without regenerating or changing the document draft or calling Gemini.
- Per-job bearer authorization on metadata, file download, upload, delete, and layout preview.
- Existing original DOCX bytes are retained privately for later milestones, when approved content can be exported.

## Install

Back up the existing `.env` and entire `storage` directory first. Stop the running server.
From your current Milestone 6 project root:

```sh
cd ~/Desktop/hackerdom/backend
patch --dry-run -p1 < ~/Downloads/docuai-m6-to-m7.patch
patch -p1 < ~/Downloads/docuai-m6-to-m7.patch
npm install
npm run check
npm test
npm run dev
```

Alternatively replace your project source with `docuai-backend-milestone-7.zip` but **never overwrite `.env` or `storage`**.

## Existing job — no additional Gemini request

Use the same `JOB_ID` and `JOB_TOKEN` from the completed Excel SOP job.

```sh
# Before upload, see default profile
curl -sS "http://127.0.0.1:3000/api/jobs/$JOB_ID/template" \
  -H "Authorization: Bearer $JOB_TOKEN" | python3 -m json.tool

# Upload any real .docx file as a template (not a .dotx, .doc, or .pdf)
curl -sS -X POST "http://127.0.0.1:3000/api/jobs/$JOB_ID/template" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  -F 'template=@/absolute/path/to/your-template.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document' \
  | python3 -m json.tool

# Preview mapping from your already saved draft onto template sections
curl -sS "http://127.0.0.1:3000/api/jobs/$JOB_ID/document/layout" \
  -H "Authorization: Bearer $JOB_TOKEN" | python3 -m json.tool

# Retrieve original uploaded template, not generated output
curl -fsS "http://127.0.0.1:3000/api/jobs/$JOB_ID/template/file" \
  -H "Authorization: Bearer $JOB_TOKEN" -o original-template.docx

# Remove custom template, revert to built-in profile
curl -sS -X DELETE "http://127.0.0.1:3000/api/jobs/$JOB_ID/template" \
  -H "Authorization: Bearer $JOB_TOKEN" | python3 -m json.tool
```

## Endpoints

| Method | Path | Meaning |
|---|---|---|
| GET | `/api/jobs/:id/template` | Profile of uploaded/default template |
| POST | `/api/jobs/:id/template` | Upload/replace `.docx` (multipart `template`) |
| GET | `/api/jobs/:id/template/file` | Download original file with bearer auth |
| DELETE | `/api/jobs/:id/template` | Remove uploaded template |
| GET | `/api/jobs/:id/document/layout` | Apply template headings/style IDs to existing JSON draft without modifying it |

## Limitations

- DOCX parsing supports conventional Word `Heading1`..`Heading6` paragraphs and outline styles, not arbitrary text boxes, tables, section breaks, nested content controls, field-based placeholders, headers/footers or full faithful Word template layout.
- Uploaded template placeholder text is never included as invented instructions. Unknown headings are exposed as unmatched, not filled.
- No `dotx`, macro-enabled `.docm`, encrypted or oversized templates.
- Milestone 8: user review and editing. Milestone 9: actual `.docx` document generation and embedding selected evidence images.
- This build was syntax-checked and validated using a real sample Word file. Full Vitest requires the npm dependencies on your Mac.
