# Milestone 5 Gemini diagnostics

This update improves safe error classification; it does **not** assume a
particular Gemini model is enabled or that quota is available.

In `src/services/analysis-service.js`, errors thrown by the Gemini SDK as
`ApiError` with HTTP status 400–599 are saved and logged as
`GEMINI_HTTP_400`, `GEMINI_HTTP_404`, `GEMINI_HTTP_429`, etc., rather than the
otherwise uninformative `GEMINI_ANALYSIS_FAILED`. Provider messages are never
stored or returned by the job API.

1. Keep your existing `.env` and `storage/` folder (the ZIP intentionally
   omits them). On macOS, replace the updated source files or apply the patch.
2. Run `npm run check` and `npm test`.
3. From the backend directory run `node scripts/diagnose-gemini.js`.
   The script makes up to 2 real API requests using synthetic data; it never
   submits existing user screenshots, private videos, or job bearer tokens.
   It checks model availability and then the precise image + JSON-schema call
   used in DocuAI. It may use quota.
4. Restart the backend (`Control+C`, `npm run dev`). Retry a failed job with
   POST `/api/jobs/:id/analyze` using its bearer token, then GET
   `/api/jobs/:id/analysis` and inspect the new `errorCode`.

Codes:
- `GEMINI_HTTP_400`: invalid request or rejected JSON schema/media
- `GEMINI_HTTP_401` or `GEMINI_HTTP_403`: authentication/permission
- `GEMINI_HTTP_404`: unknown/unavailable model endpoint
- `GEMINI_HTTP_429`: rate limit, quota or billing allocation
- `GEMINI_HTTP_500` or `GEMINI_HTTP_503`: transient provider issue
- `INVALID_AI_RESULT`, `INVALID_EVIDENCE_REFERENCE`, or
  `INVALID_STEP_TIMESTAMPS`: generated results failed DocuAI validation
- `GEMINI_ANALYSIS_FAILED`: a non-HTTP error occurred; use the synthetic test
  output and server process environment to narrow it down

Never paste your actual API key or bearer token into logs or a bug report.
