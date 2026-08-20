---
name: Full-track runtime contract
description: Product rule for exact audio-length Full-track video creation.
---

Full-track videos require analysis of the currently selected uploaded audio. They support tracks up to 600 seconds; longer tracks must be clearly rejected before a paid job starts. The output runtime, provider-clip plan, credit calculation, audio/video stitch boundary, thumbnail timing, and saved video duration must use the same target duration.

**Why:** Users expect a Full-track render to finish with their music, and an unannounced cap can create a charged video that does not match the source track.

**How to apply:** When changing Full-track durations, pricing, audio analysis, or processing paths, retain the analysis gate and validate both worker and API-server execution routes against the same bounded duration.