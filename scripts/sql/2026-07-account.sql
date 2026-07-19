-- Password reset + render-finished notification preference.
-- Raw SQL fallback for `pnpm --filter @workspace/db run push`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_on_complete boolean NOT NULL DEFAULT true;
