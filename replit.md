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

## Project: BeatVision AI

Full-stack AI music video generator (similar to freebeat.ai).

### Artifacts

- **`artifacts/beatvision`** — React + Vite frontend (preview path: `/`)
- **`artifacts/api-server`** — Express 5 backend (preview path: `/api`)

### Features

- **Auth**: Replit Auth (OIDC) — sessions stored in PostgreSQL
- **Storage**: Replit App Storage (GCS presigned URLs via `@workspace/object-storage-web`)
- **Job Pipeline**: queued → analyzing → generating → stitching → ready (background processor polling every 5s)
- **Credits System**: per-user credit tracking in DB
- **Real-time polling**: job status auto-polls every 3s while active
- **Video Gallery**: grid view with inline playback and deletion
- **Dashboard**: stats overview + recent job activity

### Shared Libraries

- `lib/api-spec` — OpenAPI spec (source of truth)
- `lib/api-client-react` — Generated React Query hooks + Zod schemas (from Orval)
- `lib/db` — Drizzle ORM schema (sessions, users, jobs, videos, credits tables)
- `lib/replit-auth-web` — `useAuth()` hook for frontend auth state
- `lib/object-storage-web` — `ObjectUploader` Uppy-based file upload component

### AI Integration

Job processor (`artifacts/api-server/src/lib/jobProcessor.ts`) stubs out AI video generation.
To activate real generation, set one of:
- `RUNWAY_API_KEY` — Runway ML
- `LUMA_API_KEY` — Luma Dream Machine
- `KLING_API_KEY` — Kling AI

### DB Schema

Tables: `sessions`, `users`, `jobs`, `videos`, `credits`
Push schema changes: `pnpm --filter @workspace/db run push`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
