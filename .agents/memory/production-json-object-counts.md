---
name: Production JSON object counts
description: Portable way to count keys in JSONB objects when querying the production database.
---

Use a row count over `jsonb_object_keys(COALESCE(value, '{}'::jsonb))` instead of `jsonb_object_length`.

**Why:** The production database rejected `jsonb_object_length(jsonb)` even though the same convenience function may be expected in other PostgreSQL environments.

**How to apply:** Use the key-set count in production diagnostics and read-only recovery queries so checks do not fail on this database capability difference.