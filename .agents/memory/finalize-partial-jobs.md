---
name: Finalize-with-partial-clips admin action
description: Rules for the manifest.finalizeWithPartial flag that stitches a stuck job from saved clips with zero provider spend.
---

Rule: any job run flagged `manifest.finalizeWithPartial=true` must never incur provider spend OR credit charges — generateClips skips generation (reuse/reclaim only), retryOrFail and the watchdog recovery must treat its retryCost as 0, and the requeue must reset retry_count=0. A media-assembly failure with saved scenes must automatically become this kind of free retry based on the live manifest, not the stale claimed-job snapshot.

**Why:** per-retry billing once charged a user 2,100 credits for a doomed retry against an empty provider wallet; a later FFmpeg-only failure also recharged a completed set of scenes even though no provider call was repeated. A "finalize" path that could be re-charged would repeat those incidents.

**How to apply:** the flag is one-shot — cleanupPartialClips drops it on terminal transitions so later requeues run normally. When salvaged clips < planned, re-spread the requested runtime across salvaged clips (recompute targetDuration) or the stitcher's `-shortest` mux ends the video early. Keep both jobProcessor copies (api-server + worker) in lockstep.
