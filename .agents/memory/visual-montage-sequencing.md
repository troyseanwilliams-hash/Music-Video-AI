---
name: Generation-mode sequencing
description: Product, billing, and recovery rules that distinguish Visual Montage from Narrative Story.
---

Visual Montage is music-first, not plot-first, but it still provisions one unique source image and animated clip per 10-second output interval. Visuals may share art direction and motifs, but the renderer must not reuse a paid source asset to fill a later interval.

Narrative Story is plot-first and non-repeating. Its reviewed storyboard is immutable after credit reservation: render one unique provider scene per chronological 5- or 10-second timeline slot, preserve each scene index through retry/recovery, and fail rather than substitute, repeat, or finalize with a missing scene.

**Why:** Long videos must contain enough generated media to cover their runtime without scene repetition. The customer estimate and atomic reservation must capture the additional provider work rather than discounting long-form Montage through reused assets.

**How to apply:** Provision and charge one unique image plus one unique clip per 10 seconds in every mode (up to 30 for 5 minutes and 60 for 10 minutes). Keep API, worker, frontend estimates, persisted plans, stitching, and Remix metadata aligned.

Strict uniqueness is content-level, not only index- or path-level.

**Why:** Providers and admin recovery can return the same media under different URLs, request IDs, encodings, grades, temporal order, or spatial orientation; distinct object paths alone do not prevent duplicate scenes.

**How to apply:** Before animation and stitching, reject exact or substantial perceptual duplicates across source images and clips, including re-encodes, grading, flips/rotations, temporal reversal/reordering, and majority footage overlap. Fail safely rather than auto-buying a replacement. Independently generated semantic similarity cannot be guaranteed away.