---
name: Generated image pricing
description: Pricing rule for source images in video jobs and standalone image packs.
---

Every generated source image, whether it belongs to an ordinary video job or a standalone Images-only pack, uses a $0.07 provider-cost basis with a 1.5× markup. Convert that amount using the conservative $0.015 credit value and round up, yielding 7 credits per image.

**Why:** A flat low image charge failed to cover provider cost. The same value must drive reservation, visible estimates, partial refunds, and image-first video pricing.

**How to apply:** Keep API server, worker, frontend pricing estimates, and the API contract aligned through one calculated per-image credit value. Review this decision before changing image models, provider cost, or the credit economy.