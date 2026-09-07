---
name: Database enum rollout
description: Ensures new PostgreSQL enum values reach development and production instead of existing only in TypeScript schema declarations.
---

When adding a PostgreSQL enum value, update the actual development database enum before publishing; changing only the Drizzle/TypeScript declaration is insufficient.

**Why:** The schema comparison uses the live development database. A value declared only in code produced no publish diff, leaving production unable to query or insert rows using the new enum label.

**How to apply:** Verify `pg_enum` in development after adding a label, then confirm the Publish schema diff contains a non-destructive `ALTER TYPE ... ADD VALUE` statement before expecting production routes to use it.