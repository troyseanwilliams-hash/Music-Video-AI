---
name: Authoritative full-track analysis
description: Trust boundary for audio-derived runtime, clip count, and credit calculations.
---

Any full-track runtime, provider-clip count, and credit reservation must come from audio analysis that the server has verified against the exact stored audio source. Never trust browser-supplied duration or section data by itself.

**Why:** Client-controlled or stale analysis can make the paid runtime diverge from the actual source, causing undercharging, excess provider cost, or an incorrect final timeline.

**How to apply:** Bind analysis to the authenticated user and stored audio object, reject unverifiable analysis for Full jobs, and ensure every supported audio source follows the same verified path before Full submission is enabled.