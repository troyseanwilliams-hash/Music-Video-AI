---
name: Long AI job request limits
description: Durable queueing and recovery rules for AI work that can outlive the app's HTTP request window.
---

Long-running AI generation must return a durable job ID immediately rather than keeping the initiating HTTP request open.

**Why:** The application proxy aborts requests at about five minutes. A generation can remain healthy and later finish server-side, while the browser reports a false failure. Retrying that ambiguous result can create duplicate paid work.

**How to apply:** Queue the work, persist the accepted provider poll handle before polling, resume that handle after worker recovery instead of resubmitting, block unsafe manual retries, fence finalization against cancellation, and make refunds idempotent with the exact charged bucket split.