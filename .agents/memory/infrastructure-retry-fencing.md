---
name: Infrastructure retry fencing
description: Safety rules for resuming large paid media jobs after database, storage, or network interruptions.
---

Treat transient infrastructure interruptions as a distinct recovery class only when the affected job flow durably records submission intent or a provider request handle before paid work can become ambiguous. Never apply a broad timeout retry to every job type.

**Why:** A generic timeout classifier can resubmit accepted billable work in flows without durable request fencing. Recovery must also avoid consuming the paid-provider retry budget, but unbounded free retries can strand a job forever.

**How to apply:** Requeue the same job under its exact claim token, preserve all saved media and request state, and use a separate bounded infrastructure counter. On exhaustion, lock the job row and verify the original claim while settling/refunding and terminalizing in one transaction; a stale runner must do nothing.