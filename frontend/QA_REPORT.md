# Frontend and backend connection verification

Verified on 11 October 2026. The supplied backend source was not modified. Dependencies and test storage were created in an isolated copy; existing database jobs and the bundled provider key were not used.

## Automated checks

- 32 frontend tests pass across 5 files, including the actual five-step JSON response supplied by your teammate.
- TypeScript checking and Vite production build pass.
- Frontend dependency installation and audit: zero reported vulnerabilities.
- Original future API and demo checks remain covered; the Milestone 5 adapter has separate schema, limits, evidence mapping, HTML escaping and token-path tests.

## Real backend browser verification

The unchanged Express backend ran locally with Node 22.14, its supplied better-sqlite3 and Sharp versions, a fresh SQLite database and real Windows FFmpeg/ffprobe tools. No Gemini key was loaded.

- Created a private backend job using the exact strict preferences/metadata schema.
- Uploaded the supplied scene.mp4: real extraction produced 8 images.
- Uploaded the Excel recording included with the backend: real extraction produced 11 images.
- Polled the actual video status endpoint and rendered real private PNG images with Authorization headers.
- Verified chronological evidence captions and timestamps, zero invented procedural steps, zero independently checked claims, and honest extraction-only labels.
- Downloaded a real PNG screenshots ZIP from the authenticated backend images.
- Reloaded and resumed the locally saved workspace; private images reloaded within the same browser session.
- Tested the alternative screenshot upload path against real Sharp normalization.
- Enabled optional analysis with no key configured: the backend returned its missing-key error, and the successfully uploaded screenshots remained available with a visible explanation.
- Desktop 1280 × 780 and mobile 390 × 844 fit without page overflow. Every A4 sheet retained 794 × 1123 dimensions and no content overflow after images loaded.
- The mobile layout and image-loading page reflow issues found during integration were fixed and the browser flow was rerun successfully.
- Custom DOCX selection is unavailable for this backend. Word/PDF actions explain that those endpoints are absent.
- No browser JavaScript exceptions occurred in the completed flows.

## Recorded AI response verification

The supplied five-step Excel JSON was tested as a fixture. A separate browser test used controlled analyze/analysis/steps responses, with the real uploaded recording and real extracted images, to verify optional analysis polling and evidence-linked rendering. This verifies response integration; it does not prove a live Gemini provider call. No live provider call was made.

## Remaining backend limits

Document composition, DOCX parsing, independent auditing, section regeneration, Word/PDF export, mixed video-plus-screenshot jobs and a cancellation endpoint are absent. See BACKEND_CONNECTION.md for the exact supported limits and setup. The frontend preserves screenshot access if optional AI analysis fails. Private image access lasts only while the browser retains the job token; download the screenshots ZIP for a portable copy.

The earlier visual revision also passed compact wizard, pointer background, outline editing/deletion, reduced-motion and long-edit A4 tests. Its detailed report remains in the previously delivered v2 ZIP.
