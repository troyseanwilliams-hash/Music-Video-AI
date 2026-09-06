---
name: Scene-first prompt ordering
description: Ordering rule for generated image and video prompts when downstream services may truncate text.
---

Generated media prompts must begin with the concrete scene subject, action, and setting. Style, lighting, camera, lens, color, and other aesthetic guidance belongs afterward.

**Why:** Downstream prompt limits may chop the end. Scene content is essential and must survive; reusable style language is less important.

**How to apply:** Enforce this in model instructions, deterministic fallbacks, and output normalization. When shortening a prompt, preserve the scene-first order rather than moving style to the front.