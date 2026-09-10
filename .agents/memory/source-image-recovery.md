---
name: Source-image recovery and validation
description: Safety rules for polling paid source-image requests and accepting generated image payloads
---

Once an image provider returns a request ID, keep polling that persisted request through transient transport failures, non-success status responses, and malformed status bodies. Never convert one polling interruption into a fresh paid submission.

**Why:** A paid request was accepted, but one status timeout caused the entire render to fail and refund. A later user attempt could duplicate provider spend even though the original request remained recoverable.

**How to apply:** Generate storyboard source images strictly in scene order and stop the batch at the first failed, exhausted, or uncertain scene; never submit a later scene while an earlier one is unresolved. Bound the polling window, resume from the saved poll URL, and fail only after the window expires or the provider returns a terminal failure. A moderation fallback needs its own durable submission intent and a durable exhausted marker; every terminal fallback outcome must close the retry before request state is cleared, or a restart can submit a third paid request. Before storing a downloaded source image, require a real decoder to successfully decode at least one image frame; signatures and container headers alone are not sufficient validation. If every planned scene already has a stored clip or valid saved poll handle, skip source-image revalidation because no provider submission is reachable. A failed/refunded job in that state may be requeued only through an admin-only, row-locked, zero-credit transition that rejects malformed, ambiguous, or terminal request state.