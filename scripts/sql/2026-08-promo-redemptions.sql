-- Promo code redemptions (e.g. COMEBACK7 = +7 days free trial). One redemption
-- per (user, code). Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_user_code_uniq
  ON promo_redemptions (user_id, code);
