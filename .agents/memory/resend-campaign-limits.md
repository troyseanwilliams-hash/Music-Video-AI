---
name: Resend campaign limits
description: Operational rules for bulk Resend sends from this project.
---

For durable campaign queues, use immutable cohorts of at most 100 recipients per local day and a unique, stable idempotency key for each recipient. Persist every accepted provider message ID. Batch APIs still require a top-level JSON array when intentionally used.

**Why:** Provider quotas can partially interrupt delivery, and idempotency retention is finite. Retrying an ambiguous timeout after the retention window can duplicate mail even with the same key.

**How to apply:** Record each recipient and outcome, never backfill a later cohort into the current day, and retry only explicit provider rejections. Treat timeouts or accepted responses without a message ID as terminal manual-review failures. Re-check disabled, unsubscribe, and current email identity immediately before sending.