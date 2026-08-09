-- First-party product analytics event log.
-- Powers the admin Analytics dashboard: funnel, time-per-page, feature usage,
-- and traffic sources. Safe to run more than once.

CREATE TABLE IF NOT EXISTS analytics_events (
  id            text PRIMARY KEY,
  anon_id       text,
  user_id       varchar REFERENCES users(id) ON DELETE SET NULL,
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

-- Time-range scans are the common access pattern for every dashboard query.
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at);
-- Filter by event type within a range (pageview vs page_time vs funnel).
CREATE INDEX IF NOT EXISTS analytics_events_type_created_idx ON analytics_events (event_type, created_at);
-- Distinct-visitor and per-visitor funnel lookups.
CREATE INDEX IF NOT EXISTS analytics_events_anon_idx ON analytics_events (anon_id);
-- Top-pages / landing-page grouping.
CREATE INDEX IF NOT EXISTS analytics_events_path_idx ON analytics_events (path);
