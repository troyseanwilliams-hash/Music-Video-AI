---
name: Provider resubmit safety
description: Rules for manually resubmitting failed paid video-generation jobs without hidden fallback requests or duplicate app-credit reservations.
---

Manual resubmission must reuse the existing app-credit reservation, atomically transition only one failed job attempt back to queued, and use the exact provider selected for that job.

**Why:** A provider submission timeout may be ambiguous, while hidden provider fallbacks and concurrent resubmit clicks can create additional paid requests.

**How to apply:** Pin provider-only generation to the persisted selection, fail if it is unavailable, condition the requeue update on the job still being failed, and never debit a new app-credit reservation for that transition.

Persisted provider requests must be recovered conservatively.

**Why:** Clearing an in-flight request or a completed request whose media download temporarily failed causes a new paid submission even though the original may still succeed.

**How to apply:** Keep pending request metadata through completion, hard failure, 404, or 410; recover completed media without new spend. A still-pending poll may requeue only within a bounded free recovery budget. Never clear a non-completed handle and fall through to a replacement POST.

Every failure after a provider POST is issued but before a valid request ID is durably saved must be recorded as an uncertain submission.

**Why:** Timeouts, 5xx responses, unreadable bodies, malformed 2xx JSON, and persistence failures can all happen after the provider accepted a billable request. Treating any of them as a normal failure exposes an unacknowledged duplicate resubmit.

**How to apply:** Persist a per-clip submission intent under the current ownership fence before POST. Atomically replace it with the poll handle on acceptance or uncertainty metadata on ambiguity. Any unresolved intent or uncertainty blocks automatic retry. Validate response shape at runtime, not only with TypeScript casts.

Image-foundation submissions follow the same durable-recovery rule, but never enter the generic paid retry path.

**Why:** An image request can be accepted before a worker dies or a poll/download/storage step fails. Requeuing it as a normal video retry can duplicate provider spend and debit the full reservation again.

**How to apply:** Persist per-image poll or uncertain-submission state atomically, resume a known poll without another charge, and re-check ownership after provider work. A complete image foundation may resume clip generation only when no clip intent or uncertainty is unresolved. Keep watchdog eligibility, retry caps, and refunds identical in API and worker.

Paid image submissions also require a durable pre-POST intent, not only an acceptance callback.

**Why:** A process can stop after the provider accepts an image but before the request ID is saved. Without a pre-submit intent, an explicit retry can create a second paid image.

**How to apply:** Write an ownership-fenced image intent before POST, atomically replace it with pending or uncertain state, and block conversion/retry while an intent is unresolved.

Timestamp claim fences must use values that round-trip through JavaScript without precision loss.

**Why:** PostgreSQL `NOW()` retains microseconds while JavaScript `Date` retains milliseconds; direct equality can reject the rightful worker.

**How to apply:** Prefer an opaque lease ID. If `claimed_at` is the token, write it with `date_trunc('milliseconds', NOW())` in every claimant before comparing the driver-mapped value.