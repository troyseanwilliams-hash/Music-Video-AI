-- Analytics events table for tracking pageviews, funnels, and feature usage.
-- anon_id ties anonymous sessions together; user_id links to a real account
-- once the visitor signs in. utm_* columns capture acquisition source.
CREATE TABLE IF NOT EXISTS analytics_events (
  id            text PRIMARY KEY,
  anon_id       text,
  user_id       text REFERENCES users(id) ON DELETE SET NULL,
  event_type    text NOT NULL,
  path          text,
  referrer      text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  duration_ms   integer,
  meta          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx    ON analytics_events (user_id);
CREATE INDEX IF NOT EXISTS analytics_events_anon_id_idx    ON analytics_events (anon_id);
CREATE INDEX IF NOT EXISTS analytics_events_event_type_idx ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at DESC);
