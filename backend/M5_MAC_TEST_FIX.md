# Milestone 5 – intermittent video-upload EPIPE test correction

Your macOS Vitest run reported 154/155 passing tests with `write EPIPE` in
`test/video.test.js`'s invalid-upload/authentication test.

## Root cause

`test/video.test.js` streamed a 3-second MP4 to `POST /api/jobs/:id/video`
under conditions where the server is designed to reject immediately:
wrong bearer token, job `inputType: screenshots`, or an already-uploaded video.
An early 404/409 response can close the connection while Superagent is still
sending the file, resulting in a client-side `EPIPE` instead of the expected
HTTP status. Invalid MIME-type validation similarly rejects at multipart
headers, before the file payload is read.

## Changes

Only `test/video.test.js` is changed:

- Requests testing **pre-upload authorization / job-state checks** now send a
  tiny JSON body. Those checks execute before the multipart content-type check
  and still assert exactly the same expected HTTP 404/409.
- The unsupported MIME test now sends a small in-memory invalid attachment,
  preserving the actual Multer file-type rejection test while avoiding a large
  file stream racing against an early error response.
- The successful MP4 upload, corrupted-video check and MIME/container mismatch
  still exercise real multipart uploads and decoding.

No production source, database, authentication, migrations, or API behavior is modified.

## Applying only the patch

From your existing `backend` directory:

```bash
cp test/video.test.js test/video.test.js.bak
patch -p1 < ~/Downloads/docuai-m5-video-epipe-test-fix.patch
npm run check
npx vitest run test/video.test.js
npm test
```

If you already modified your `test/video.test.js` locally, review the patch
before applying. Target results: 9 test files and 155 tests passing; this is
not a confirmed full-suite result until you run it on your Mac.
