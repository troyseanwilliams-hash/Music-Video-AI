---
name: Lip Sync opt-in controls
description: Product rule for how users configure optional Lip Sync on generated videos.
---

Lip Sync must remain an optional add-on, disabled by default. A user must explicitly enable it before selecting a song segment or uploading a face image. The selected segment duration is user-configurable in whole seconds from 5 through 30, and pricing must continue to use the chosen duration.

When selected during Full-track Generate, Lip Sync is a bundle: show and reserve the video-generation cost plus the duration-based Lip Sync cost as one total, then automatically create a separate Lip Sync video after the source video succeeds. Do not charge the child job again. If source generation fails before handoff, return the combined reservation; if only the child fails after handoff, return only the Lip Sync portion.

For Lip Sync added to an already-completed, non-bundled video, the source video has already been paid for, so charge only the new Lip Sync segment.

**Why:** The user confirmed the bundled Generate model on 2026-08-20: choosing Lip Sync at video creation must produce both videos and compound both costs, without a later second charge.

**How to apply:** Keep the Full-track controls hidden until opt-in, require a face image and exact range before confirmation, display the base/add-on breakdown, and keep parent/child reservation transfer and partial refunds idempotent.