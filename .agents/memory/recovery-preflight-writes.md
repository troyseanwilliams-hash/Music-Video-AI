---
name: Recovery preflight writes
description: Keep retained-media recovery from stalling before it reaches accepted provider outputs.
---

Recovery preflight loops must not write job progress when the computed progress has not increased. A fully retained image foundation should pass directly to accepted-request recovery with no per-scene database updates.

**Why:** A long image-first render had every source image already stored, but retry preflight still issued one progress update per scene. Intermittent database connection timeouts turned those no-op writes into a multi-minute delay before the worker could collect an already-completed scene.

**How to apply:** Compute the next progress value first and persist only when it is greater than the last reported value. Preserve explicit ownership checks around paid calls and accepted-output reads; optimize only redundant status writes.