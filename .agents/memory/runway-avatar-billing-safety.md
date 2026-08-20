---
name: Runway Avatar billing safety
description: Guardrails for paid Runway Avatar Video experiments
---

Rule: Do not enable a paid Runway Avatar Video flow unless the avatar lifecycle is confirmed against the documented endpoint: persist the provider avatar ID, wait for its ready state with a bounded timeout, and submit the video only after readiness. Treat any pre-submission state failure as non-retryable until its idempotency and billing behavior are verified.

**Why:** Immediate submits while an Avatar was still processing caused repeated provider requests that could not produce a video, while automatic retries multiplied external spend.

**How to apply:** Keep experimental paid flows behind a separate, default-off feature gate. Record the exact subscription/top-up debit split for every attempt; only retry once the provider documents safe idempotency or an unpaid failure mode.