-- Reusable vertical AI stills for Remix Lab image packs.
DO $$
BEGIN
  ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'image_pack';
EXCEPTION
  WHEN undefined_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS image_assets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  asset_index integer NOT NULL,
  object_path text NOT NULL,
  prompt text NOT NULL,
  style video_style,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS image_assets_job_index_unique
  ON image_assets (job_id, asset_index);