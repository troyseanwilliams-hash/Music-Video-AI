-- Watermark flag on jobs (Starter tier exports burn an "AIBeatSync" watermark).
-- Raw SQL fallback for `pnpm --filter @workspace/db run push`.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS watermark boolean NOT NULL DEFAULT false;
