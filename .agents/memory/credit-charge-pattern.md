---
name: Credit charge/refund pattern
description: How paid API endpoints must charge and refund credits safely
---
Rule: any route that charges credits for a paid provider call must (1) debit inside a transaction with `SELECT ... FOR UPDATE` and a balance check (no read-then-clamped-update — concurrent requests double-spend), (2) record the exact subscription/topup split debited and refund that same split on failure (refunding to topup converts expiring credits into permanent ones), (3) verify object ownership (`canAccessObjectEntity`) before signing user-supplied object paths, and (4) validate the provider output is usable before keeping the charge.

**Why:** code review of the lyric-align endpoint found double-spend races, bucket corruption on refund, and an object-path disclosure hole in the naive prompt.ts-style helpers (which still have these flaws).

**How to apply:** copy the pattern from artifacts/api-server/src/routes/lyrics.ts when adding new paid endpoints; teasers.ts now uses the atomic pattern too (fixed later), but prompt.ts chargeCredits is still legacy, not a template. Also: once work is durably delivered (e.g. video row inserted), post-delivery failures like URL signing must NOT refund.

Explicit retries of refunded jobs are new paid attempts: atomically reserve from the user's current subscription/topup buckets, record that new split for any later refund, and refuse only when the current total cannot cover the attempt. Clear an uncertain provider-submission marker only as part of that explicit retry.
