# Recover AI-generated instructions after a Gemini HTTP 503

This frontend-only fix is compatible with the Milestone 7 backend. It does not change the database, videos, API key, or Word-template upload implementation.

## What changed

- If **Analyse with Gemini** was enabled, a failed analysis no longer masquerades as a completed screenshot-only document.
- HTTP 502/503/504 analysis failures trigger up to **two bounded retries**, using the **same private job** and the already-uploaded evidence. Permanent errors such as HTTP 400 and quota HTTP 429 are never auto-retried.
- If Gemini remains unavailable, the processing screen displays an actionable failure. **Retry analysis on this job** reuses the previous evidence rather than creating a fresh upload.
- A previously created screenshot-only fallback draft has a **Retry AI analysis** button in the Document Health sidebar. It works on saved drafts restored in the same browser session, even when the original File objects have been lost; the job type and frames are fetched from the backend.
- Backend steps and captions are displayed only if Gemini actually finishes successfully and the backend generates the document. This avoids presenting frames as an AI-generated SOP.

## Apply

From your existing integrated frontend directory:

```bash
cd ~/Desktop/hackerdom/docuai-m7-integrated-website/frontend
patch --dry-run -p1 < ~/Downloads/docuai-m7-gemini-503-recovery.patch
patch -p1 < ~/Downloads/docuai-m7-gemini-503-recovery.patch
npm test
npm run build
npm run dev
```

Use **one** installation method: the patch OR the complete replacement frontend ZIP. Do not use both.

## Your existing screenshot-only editor

If you can still view the failed draft, look in **Document health** for **Retry AI analysis**. This resumes the **same private job**, with its existing video frames or screenshots; it does not re-upload media. If you refreshed the browser, use **Resume editing** to restore the locally saved draft first. Job credentials remain in browser session storage and are not embedded in your exported JSON.

The backend needs `GEMINI_MODEL=gemini-3.5-flash` (or another model that works for your key), `GEMINI_API_KEY`, and a running server on port 3000. A persistent HTTP 503 is a provider-side issue: retry later rather than repeatedly regenerating new jobs.

## Validation

Frontend TypeScript/TSX syntax has been checked using the TypeScript compiler's transpiler. The Vitest suite and full Vite production build must be run locally because this packaging environment has no installed frontend npm packages.
