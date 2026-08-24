-- Public generated-image Explore support. Safe to run repeatedly against
-- databases created before image_assets gained visibility and engagement data.
ALTER TABLE image_assets
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_creator_anonymous boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

-- Defend against partially applied/manual versions of the columns before
-- restoring the runtime schema's non-null defaults.
UPDATE image_assets
SET
  is_public = COALESCE(is_public, false),
  is_creator_anonymous = COALESCE(is_creator_anonymous, false),
  like_count = COALESCE(like_count, 0)
WHERE is_public IS NULL
   OR is_creator_anonymous IS NULL
   OR like_count IS NULL;

ALTER TABLE image_assets
  ALTER COLUMN is_public SET DEFAULT false,
  ALTER COLUMN is_public SET NOT NULL,
  ALTER COLUMN is_creator_anonymous SET DEFAULT false,
  ALTER COLUMN is_creator_anonymous SET NOT NULL,
  ALTER COLUMN like_count SET DEFAULT 0,
  ALTER COLUMN like_count SET NOT NULL;

CREATE TABLE IF NOT EXISTS image_asset_likes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_asset_id text NOT NULL REFERENCES image_assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, image_asset_id)
);