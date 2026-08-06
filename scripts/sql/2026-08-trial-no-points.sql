-- Trial users no longer receive free credits ("points"). The trial gives access
-- to the free features; points are granted only on subscription. This changes
-- the DEFAULT for NEW credit rows — existing balances are left untouched.
ALTER TABLE credits ALTER COLUMN credits_remaining SET DEFAULT 0;
ALTER TABLE credits ALTER COLUMN subscription_credits SET DEFAULT 0;
