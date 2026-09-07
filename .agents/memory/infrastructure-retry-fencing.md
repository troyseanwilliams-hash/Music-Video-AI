---
name: Infrastructure retry fencing
description: Safety rules for resuming large paid media jobs after database, storage, or network interruptions.
---

Treat transient infrastructure interruptions as a distinct recovery class only when the affected job flow durably records submission intent or a provider request handle before paid work can become ambiguous. Never apply a broad timeout retry to every job type.

**Why:** A generic timeout classifier can resubmit accepted billable work in flows without durable request fencing. Recovery must also avoid consuming the paid-provider retry budget, but unbounded free retries can strand a job forever.

**How to apply:** Requeue the same job under its exact claim token, preserve all saved media and request state, and use separate bounded counters for infrastructure and GET-only provider polling recovery. Poll recovery must be atomic, independent of the paid retry counter, and shared by normal timeout and watchdog paths. Require every saved handle to be valid and reject mixed intent, uncertainty, or terminal state. Treat malformed counters as exhausted. Treat a failure of the stable job-progress checkpoint write as infrastructure, not a media failure. If an image-first job has an approved retained image set and its original reservation is still held, saved clips and accepted pending requests may resume without another charge. On exhaustion, lock the job row and verify the original claim while settling/refunding and terminalizing; a stale runner must do nothing.