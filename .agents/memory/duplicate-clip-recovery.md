---
name: Post-approval generated clip duplicates
description: The boundary between pre-approval image uniqueness and post-approval video clip handling.
---

Enforce image uniqueness before the user approves the storyboard images. After approval, generated video clips may contain repeated visual content and must proceed to stitching without duplicate-clip rejection or automatic replacement.

**Why:** Approval establishes the user's accepted visual plan. A later video-level similarity check can reject intentional continuity or provider motion derived from approved images after every paid scene request has already completed.

**How to apply:** Keep duplicate checks in image planning/review. Do not fingerprint generated clips for uniqueness after approval. Legacy jobs failed by the former clip check should reuse their complete saved clip set and stitch without another provider request.