---
name: Resend campaign limits
description: Operational rules for bulk Resend sends from this project.
---

Resend's batch endpoint expects the messages as a top-level JSON array, not an object wrapper. Send at most 100 messages per request and use a stable per-batch idempotency key so a later resume does not duplicate accepted batches.

**Why:** A full-list send can be partially accepted when the provider's daily quota is reached; treating the campaign as all-or-nothing would either lose recipients or duplicate already accepted messages.

**How to apply:** Keep the recipient manifest stable for the campaign, record the last accepted batch, resume only from the next batch after quota recovery, and continue excluding disabled or unsubscribed users.