# Gemini image + structured-JSON compatibility correction

Live diagnostic: API key and model text generation passed, but the actual DocuAI
image-plus-schema request returned Google HTTP 400 INVALID_ARGUMENT. The exact
invalid argument is not identified by the generic provider response.

The analyzer removes the legacy `temperature: 0.2` setting (deprecated for
Gemini 3.8 Flash), and keeps strict responseJsonSchema as the primary request. If Google
rejects that request with **ApiError HTTP 400**, it makes **one** retry using the
same image pixels, original evidence IDs, and JSON MIME mode, but without the
provider-side responseJsonSchema option. It does NOT fall back on 403/404/429,
and never bypasses the existing Zod data-shape, evidence ownership, ordering,
or timestamp validation before writing steps. The second API call may use quota.

The server emits `gemini_schema_fallback` with `mode: json_only` when using the
retry, without logging the API key or original exception text.

## Apply the one-file-plus-tests patch

Stop the backend and, from `~/Desktop/hackerdom/backend`, run:

```bash
cp src/services/gemini-analyzer.js src/services/gemini-analyzer.js.bak
patch -p1 < ~/Downloads/docuai-m5-gemini-schema-fallback.patch
npm run check
npm test
node scripts/diagnose-gemini.js
```

This patch also modifies `src/server.js`, the diagnostic script, and
`test/analysis.test.js`. Inspect `TEST 2A` (image-only) and `TEST 2B`
(JSON analysis) to distinguish image-request failures from schema failures.

If all tests and the real diagnostic pass, restart `npm run dev` and retry
`POST /api/jobs/:id/analyze` on your existing failed job. No new upload is needed.

No Gemini live request can be run without the user's private API key.
