---
name: Generation-mode sequencing
description: Product, billing, and recovery rules that distinguish Visual Montage from Narrative Story.
---

Visual Montage is music-first, not plot-first. Build a small library of focused visual motifs, then intentionally recur those motifs across short music-timed cuts. Do not stretch each source clip into one long contiguous block or ask one clip to depict an entire multi-beat story.

Narrative Story is plot-first and non-repeating. Its reviewed storyboard is immutable after credit reservation: render one unique provider scene per chronological 5- or 10-second timeline slot, preserve each scene index through retry/recovery, and fail rather than substitute, repeat, or finalize with a missing scene.

**Why:** Montage stays affordable by separating paid provider renders from edit cuts. Narrative's higher price must come from actual unique provider work, and substituting a surviving scene would break both the reviewed story and the billing promise.

**How to apply:** Keep mode-aware clip counts, pricing, estimates, persisted plans, processor behavior, strict stitching, and Remix metadata aligned across API, worker, and frontend. Old or unmarked jobs default to Montage.