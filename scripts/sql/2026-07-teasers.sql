-- Auto-generated TikTok/Shorts teaser clips.
-- Raw SQL fallback for `pnpm --filter @workspace/db run push`.

ALTER TABLE videos ADD COLUMN IF NOT EXISTS teasers jsonb;
