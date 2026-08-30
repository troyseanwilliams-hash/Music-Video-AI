---
name: Image-first partial settlement
description: Billing rule for failed or canceled jobs that already produced durable images or accepted scene requests.
---

Failed, canceled, stale, and deleted image-first jobs must settle the original reservation exactly once. Durable source images and confirmed or uncertain accepted video-scene requests remain charged; only unfinished image and video work is refunded using the original subscription/top-up split.

**Why:** Full refunds after partial provider success give away retained paid images and accepted video work, while separate refund paths can race and return credits twice or to the wrong bucket.

**How to apply:** Lock the job row, count canonical durable image assets and deduplicated accepted scene indexes, compute retained charges from the original image/video prices, restore the untouched reservation remainder to its original buckets, and atomically mark the reservation settled. Use the durable initial-generation map when review substitutions can replace an asset, so free gallery/uploads are not mistaken for newly generated work.

A retained-image resume must create a fresh reservation for unfinished video work only. Keep already-settled images excluded from the new settlement basis, store the new subscription/top-up split, and require the locked job to still be awaiting approval before debiting. Do not reuse this parent-only path for a bundled child job with its own reservation.

**Why:** Reusing the original settled metadata can charge retained images twice, return credits to stale buckets, or debit after a concurrent cancellation has already made the job ineligible.

**How to apply:** Reopen review without charging, validate replacement images first, then lock the job and current credit row, reserve only the refunded parent-video remainder, reset the reservation metadata to video-only, and queue in the same transaction.