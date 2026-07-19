-- Referral / share-to-earn credits (FEATURE_ROADMAP unit 7).
-- Raw SQL fallback for `pnpm --filter @workspace/db run push`.

ALTER TYPE credit_grant_source ADD VALUE IF NOT EXISTS 'referral';

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code varchar UNIQUE;

CREATE TABLE IF NOT EXISTS referrals (
  id text PRIMARY KEY,
  referrer_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'credited',
  referrer_credits integer NOT NULL DEFAULT 0,
  referred_credits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
