# Milestone 4 — Screen recordings and FFmpeg frame preprocessing

This package extends the corrected Milestone 3 backend **without changing previous
migrations or existing job/screenshot API contracts**. Migration 4 adds `job_videos`
and `video_frames` tables. The user's original SQLite storage and uploaded screenshots
must be preserved when upgrading.

## Capabilities

- Authenticated MP4, MOV (QuickTime), and WebM upload, **one recording per `inputType=video` job**.
- 80 MiB limit; max 180 s, max 4096x2160. File signature and `ffprobe` verify
  the actual format; client MIME and filename are never trusted alone.
- Original recording remains private under `storage/uploads/<jobId>/video/`.
- `POST /api/jobs/:id/video` returns **202 Accepted** with a status immediately;
  in-process background preparation extracts timestamped PNG samples using FFmpeg.
- Sampling analyzes coarse visual differences and retains periodic frame anchors,
  in chronological order (maximum 60). **Not AI step detection**: procedural step
  starts/ends and AI captions are Milestone 5 tasks.
- Poll status with `GET /api/jobs/:id/video` (`queued`, `processing`, `ready`, `failed`).
- Private original-video and sampled-frame retrieval; delete only when finished.
- Restart recovery: pending preparation jobs stored in SQLite are retried on startup.
- Only the job-specific bearer token can read or delete evidence.
- Source paths, token hashes and local filesystem information are never returned in API JSON.

## Install (MacBook Air M1)

```bash
brew install ffmpeg
ffmpeg -version
ffprobe -version
cd /absolute/path/to/backend
npm install
npm run check
npm test
npm run dev
```

After npm install generates/updates `package-lock.json`, commit it for reproducible
teammate installs and switch to `npm ci` for clean installs. No Gemini API key is
needed for M4. No new npm dependencies beyond those from M3 are required.

**Before upgrading existing backend:** stop the server, back up `storage/`
(including the SQLite file and existing uploads) and `.env`, copy over the new
source without overwriting `storage/`. Migration 4 is applied automatically.

## Video workflow, curl example

Create a video job:

```bash
curl -s -X POST http://127.0.0.1:3000/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"preferences":{"writingTone":"professional","documentType":"sop","inputType":"video"},"metadata":{"title":"Recording of Excel workflow"}}'
```

Save the returned `job.id` and **one-time** `accessToken` locally:

```bash
export JOB_ID='paste-your-real-job-uuid'
export JOB_TOKEN='paste-your-real-access-token'

# Upload an actual video, not an image:
curl -i -X POST "http://127.0.0.1:3000/api/jobs/$JOB_ID/video" \
  -H "Authorization: Bearer $JOB_TOKEN" \
  -F "video=@/absolute/path/to/recording.mp4;type=video/mp4"

# Poll until video.processingStatus is "ready" (or "failed"):
curl -s "http://127.0.0.1:3000/api/jobs/$JOB_ID/video" \
  -H "Authorization: Bearer $JOB_TOKEN"

# Download one frame using a real frame UUID from the previous response:
export FRAME_ID='paste-frame-uuid'
curl -fsS "http://127.0.0.1:3000/api/jobs/$JOB_ID/video/frames/$FRAME_ID" \
  -H "Authorization: Bearer $JOB_TOKEN" -o evidence-frame.png

# Download the original recording (optional):
curl -fsS "http://127.0.0.1:3000/api/jobs/$JOB_ID/video/file" \
  -H "Authorization: Bearer $JOB_TOKEN" -o original.mp4

# Remove it to permit re-uploading a different recording:
curl -i -X DELETE "http://127.0.0.1:3000/api/jobs/$JOB_ID/video" \
  -H "Authorization: Bearer $JOB_TOKEN"
```

### Request and response contracts

| Method | Route | Behavior |
| --- | --- | --- |
| `POST` | `/api/jobs/:id/video` | Multipart `video` file; 202, background processing |
| `GET` | `/api/jobs/:id/video` | Metadata, extraction state, ordered frame records |
| `GET` | `/api/jobs/:id/video/file` | Private original MP4/MOV/WebM bytes |
| `GET` | `/api/jobs/:id/video/frames/:frameId` | Private PNG frame; available after `ready` |
| `DELETE` | `/api/jobs/:id/video` | Remove ready/failed recording and frames; job goes back to `created` |

A video job cannot also upload screenshots. Video processing status is separate
from the job's AI-processing status: `job.status=uploaded` means source evidence
is saved; `video.processingStatus=ready` means sampled frames are available.

### Current MVP limitations

- **No Gemini step identification, segment boundaries, action captions, template
  rendering, document export, or inconsistency checking yet.** Those follow M4.
- Frame timestamps are **approximated from FFmpeg's sampling interval**, not
  frame-accurate presentation timestamps. They are chronological sampling cues,
  not asserted action boundaries.
- The in-process worker handles one video at a time and retries queued/incomplete
  jobs after server restart. It is suitable for a single-instance hackathon demo;
  use a durable work queue and distributed lock for multi-instance deployment.
- No user-account authentication: random per-job bearer tokens protect private
  access, but job creation is open in the local development build.
- Media decoding is resource-intensive; for a public deployment, run FFmpeg in a
  separately sandboxed worker with CPU, memory and disk quotas, request rate
  limiting and retention policies.

## Verification

`npm run check` verifies all production JS syntax. `npm test` includes actual
short-video FFmpeg processing tests when `ffmpeg` and `ffprobe` are installed.
The previous 142 tests may gain additional version-4 expectations. See
`MILESTONE_4_VERIFICATION.md` for the local verification record. Report the
actual result of `npm test` from your MacBook before approving this milestone.
