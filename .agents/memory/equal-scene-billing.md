---
name: Equal scene billing
description: Why Kling 4.0 plans use equal billable scene lengths rather than shortening only the final provider request.
---

Keep billable scene lengths equal within a Kling 4.0 generation, rounding each to whole seconds and trimming only the stitched output to the requested runtime.

**Why:** Partial settlement divides the reserved video cost evenly across the scene count. A cheaper final provider request would make that refund calculation inaccurate unless settlement also became duration-weighted. Pricing must reflect the rounded provider seconds, not only exported seconds.

**How to apply:** Any future optimization that shortens the final paid shot must update estimates, reservations, accepted-scene settlement, and refund tests together. Preserve legacy model pricing.

When an ending-frame reference is attached, retime the complete final clip into its remaining export slot instead of trimming away its tail.

**Why:** Equal paid lengths can exceed the requested export runtime (45 seconds requires two paid 23-second shots). Cutting the concatenation at 45 seconds removes the requested ending frame.

**How to apply:** Keep billed durations unchanged, normalize assembly frame rates/timebases consistently, and verify the final frame with a non-divisible-runtime render test in both processors.
