# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Project: AI Beat Sync

Full-stack AI music video generator (similar to freebeat.ai).

### Artifacts

- **`artifacts/beatvision`** — React + Vite frontend (preview path: `/`)
- **`artifacts/api-server`** — Express 5 backend (preview path: `/api`)
- **`artifacts/worker`** — Dedicated background job worker (port 9000, VM deployment)

### Features

- **Auth**: Custom email/password auth — bcrypt-hashed passwords stored in PostgreSQL, sessions in `sessions` table
- **Storage**: Replit App Storage (GCS presigned URLs via sidecar at `127.0.0.1:1106`)
- **Job Pipeline**: queued → analyzing → generating → stitching → ready
- **Background Processing**: Atomic job claiming via `FOR UPDATE SKIP LOCKED` (safe for multiple concurrent workers)
- **Retry Logic**: Failed jobs retry up to 3× with exponential backoff (2min, 4min, 8min)
- **Real-time Updates**: SSE endpoint (`GET /api/jobs/:id/events`) using pg LISTEN/NOTIFY; frontend falls back to 3s polling if SSE unavailable
- **Credits System**: per-user credit tracking in DB
- **Video Gallery**: grid view with inline playback and deletion
- **Dashboard**: stats overview + recent job activity

### AI Video Generation

Job processor (`artifacts/api-server/src/lib/jobProcessor.ts` and `artifacts/worker/src/lib/jobProcessor.ts`) supports:
- **Runway ML Gen-3 Turbo**: set `RUNWAY_API_KEY`
- **Luma Dream Machine**: set `LUMA_API_KEY`
- **Simulation mode**: if neither key is set, simulates a 4s generation (dev/demo)

Generated videos are downloaded from the AI provider and stored in Replit App Storage at `/objects/videos/<videoId>.mp4`.

### Generator Settings (compact toolbar)

The generate page includes a compact settings toolbar with:
- **Character** — dropdown: None, Person, Couple, Crowd, Abstract, Animal (injected into AI prompt)
- **Aspect Ratio** — dropdown: 16:9 (default), 9:16, 1:1, 4:3, 21:9 (passed to Runway API with correct ratio strings)
- **Resolution** — dropdown: 720p (default), 1080p
- **Style** — scrolls to the visual style grid below
- **Captions** — toggles the lyrics/subtitle overlay section
- **Remove Watermark** — sends `watermark: false` to Runway API when enabled
- **Edit** — focuses the prompt textarea

Reference image (optional): users can upload a JPG/PNG/WebP that becomes the `promptImage` for every Runway clip (replaces the 1×1 dummy pixel). Stored in object storage, loaded as base64 data URL at job processing time.

DB columns: `aspect_ratio`, `resolution`, `character`, `remove_watermark`, `reference_image_path` on `jobs` table.
OpenAPI fields: `aspectRatio`, `resolution`, `character`, `removeWatermark`, `referenceImagePath` on `CreateJobRequest`.

Runway ratio mapping (`videoApis.ts`): `16:9→1280:768`, `9:16→768:1280`, `4:3→1104:832`, `1:1→960:960`, `21:9→1584:672`.

### Smart Prompt Building

Audio is analyzed with `music-metadata` to extract BPM, energy, mood, and section structure. A rich AI prompt is then constructed from:
- Visual style (cinematic, neon, anime, etc.)
- Tempo descriptor (fast-paced, atmospheric, etc.)
- Energy level (intense, vibrant, calm)
- Dominant section label (chorus, drop, etc.)
- User's custom prompt text

### DB Schema

Tables: `sessions`, `users`, `jobs`, `videos`, `credits`

Key job columns: `retry_count` (int, default 0), `claimed_at` (timestamp) — used for atomic claiming and retry tracking.

Push schema changes: `pnpm --filter @workspace/db run push`

### Shared Libraries

- `lib/api-spec` — OpenAPI spec (source of truth)
- `lib/api-client-react` — Generated React Query hooks + Zod schemas (from Orval)
- `lib/db` — Drizzle ORM schema (sessions, users, jobs, videos, credits tables)
- `artifacts/beatvision/src/hooks/useAuth.ts` — custom `useAuth()` hook (React Query, no third-party auth lib)
- `lib/object-storage-web` — `ObjectUploader` Uppy-based file upload component

### Deployment Configuration

| Artifact       | Type      | Notes                                              |
|---------------|-----------|----------------------------------------------------|
| beatvision    | Static    | React+Vite SPA, no server                          |
| api-server    | VM        | Runs job processor in prod (`RUN_JOB_PROCESSOR=true`) |
| worker        | VM        | Dedicated job processor, health at `/worker/health` |

In production, both api-server and worker can run the job processor safely — `FOR UPDATE SKIP LOCKED` ensures each job is claimed by exactly one worker.

## Key Commands

```bash
# Install deps
pnpm install

# Push DB schema
pnpm --filter @workspace/db run push

# Build api-server
pnpm --filter @workspace/api-server run build

# Build worker
pnpm --filter @workspace/worker run build

# Typecheck all
pnpm run typecheck

# Codegen (OpenAPI → React Query hooks)
pnpm --filter @workspace/api-spec run codegen
```
