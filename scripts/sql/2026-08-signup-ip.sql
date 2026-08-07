-- Track the client IP at registration to limit multiple free-trial accounts
-- from the same network. Indexed for the per-IP count check.
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip varchar;
CREATE INDEX IF NOT EXISTS users_signup_ip_idx ON users (signup_ip);
