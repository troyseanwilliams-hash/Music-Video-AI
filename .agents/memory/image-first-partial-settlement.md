---
name: Image-first partial settlement
description: Billing rule for failed or canceled jobs that already produced durable images or accepted scene requests.
---

Failed, canceled, stale, and deleted image-first jobs must settle the original reservation exactly once. Durable source images and confirmed or uncertain accepted video-scene requests remain charged; only unfinished image and video work is refunded using the original subscription/top-up split.

**Why:** Full refunds after partial provider success give away retained paid images and accepted video work, while separate refund paths can race and return credits twice or to the wrong bucket.

**How to apply:** Lock the job row, count canonical durable image assets and deduplicated accepted scene indexes, compute retained charges from the original image/video prices, restore the untouched reservation remainder to its original buckets, and atomically mark the reservation settled.