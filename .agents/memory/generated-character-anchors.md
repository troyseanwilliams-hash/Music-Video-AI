---
name: Generated character anchors
description: Consistency-reference policy when a user does not upload a character image.
---

When there is no uploaded character reference, the earliest durably persisted character-focused scene image becomes the reference for later character-focused scenes. The anchor remains a reference input only; every scene still receives its own unique generated image. Uploaded references always take precedence, and environment, object, and atmosphere scenes receive no character reference.

**Why:** Reusing a generated anchor improves character consistency without weakening the one-unique-image-per-scene contract or leaking character instructions into unrelated scenes. Deriving the anchor from durable assets makes retries and worker restarts deterministic.

**How to apply:** Determine character relevance before building or submitting each prompt. Select the earliest canonical persisted character asset on every resume, use no generated reference for the first character scene, and route the anchor only to later character-focused scenes.