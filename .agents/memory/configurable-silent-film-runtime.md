---
name: Configurable silent-film runtime
description: Product rule for prompt-only video duration.
---

No-audio videos use a user-entered whole-second runtime within the supported render limit, not a hard-coded duration selected for one example or prompt.

**Why:** Silent creation has no audio track from which to derive duration. A fixed runtime would incorrectly turn one user's example into a product constraint.

**How to apply:** Carry the configured duration through storyboard preview, preflight pricing, credit reservation, persisted job duration, and worker planning. Keep the server-side limit authoritative.