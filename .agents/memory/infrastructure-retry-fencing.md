---
name: Infrastructure retry fencing
description: Safety rules for resuming large paid media jobs after database, storage, or network interruptions.
---

Treat transient infrastructure interruptions as a distinct recovery class only when the affected job flow durably records submission intent or a provider request handle before paid work can become ambiguous. Never apply a broad timeout retry to every job type.

**Why:** A generic timeout classifier can resubmit accepted billable work in flows without durable request fencing. Recovery must also avoid consuming the paid-provider retry budget, but unbounded free retries can strand a job forever.

Heartbeats prove ownership/liveness, not useful rendering progress. Never describe an unchanged stage percentage as confirmed forward progress solely because its heartbeat is fresh.

**Why:** A render kept heartbeating through repeated infrastructure interruptions while its user-visible stage stayed unchanged for hours. Media-processing and transfer deadlines must cancel actual work, not just reject a detached promise.

Complete-saved-clip recovery must bypass image preparation and image-review replacements, fail closed if saved coverage disappears, and explicitly allow refunded completion under the current claim fence without credits writes or bundled paid-child activation.

**Why:** Requeueing alone can revisit paid image paths; the normal refunded-finalization guard can reject an otherwise successful courtesy recovery. Check eligibility before transactional writes, and preserve the exception through free retries.

**How to apply:** Requeue the same job under its exact claim token, preserve all saved media and request state, and use separate bounded counters for infrastructure and GET-only provider polling recovery. Poll recovery must be atomic, independent of the paid retry counter, and shared by normal timeout and watchdog paths. Require every saved handle to be valid and reject mixed intent, uncertainty, or terminal state. Treat malformed counters as exhausted. Treat job-ownership and stable-progress query failures as infrastructure, not media corruption. If every planned scene has a saved clip or accepted handle, that coverage outranks stale finalize-only state and must route through a row-locked zero-charge transition—even from bulk admin recovery—rather than ordinary retry. If an image-first job has an approved retained image set and its original reservation is still held, saved clips and accepted pending requests may resume without another charge. On exhaustion, lock the job row and verify the original claim while settling/refunding and terminalizing; a stale runner must do nothing.