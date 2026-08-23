---
name: Provider resubmit safety
description: Rules for manually resubmitting failed paid video-generation jobs without hidden fallback requests or duplicate app-credit reservations.
---

Manual resubmission must reuse the existing app-credit reservation, atomically transition only one failed job attempt back to queued, and use the exact provider selected for that job.

**Why:** A provider submission timeout may be ambiguous, while hidden provider fallbacks and concurrent resubmit clicks can create additional paid requests.

**How to apply:** Pin provider-only generation to the persisted selection, fail if it is unavailable, condition the requeue update on the job still being failed, and never debit a new app-credit reservation for that transition.

Persisted provider requests must be recovered conservatively.

**Why:** Clearing an in-flight request or a completed request whose media download temporarily failed causes a new paid submission even though the original may still succeed.

**How to apply:** Keep pending request metadata until the provider confirms it is terminal/gone; recover completed media without new spend and preserve uncertain requests for a later explicit resubmit.

Every failure after a provider POST is issued but before a valid request ID is durably saved must be recorded as an uncertain submission.

**Why:** Timeouts, 5xx responses, unreadable bodies, malformed 2xx JSON, and persistence failures can all happen after the provider accepted a billable request. Treating any of them as a normal failure exposes an unacknowledged duplicate resubmit.

**How to apply:** Persist sanitized uncertainty metadata per clip, block the ordinary retry route, and require a separate explicit acknowledgement before clearing uncertainty and requeueing. Validate response shape at runtime, not only with TypeScript casts.

Image-foundation submissions follow the same durable-recovery rule, but never enter the generic paid retry path.

**Why:** An image request can be accepted before a worker dies or a poll/download/storage step fails. Requeuing it as a normal video retry can duplicate provider spend and debit the full reservation again.

**How to apply:** Persist per-image poll or uncertain-submission state atomically, resume a known poll instead of submitting again, and re-check ownership after provider work. Any stale or unconfirmed image-first stage fails and refunds its reservation idempotently rather than auto-requeueing; apply this in both processors.