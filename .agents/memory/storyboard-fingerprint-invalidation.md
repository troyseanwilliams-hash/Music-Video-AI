---
name: Storyboard fingerprint invalidation
description: Keeps reviewed scene prompts synchronized with every input used by the authoritative server planner.
---

Any client setting consumed by storyboard planning must invalidate the current reviewed prompt plan, clear approval, and trigger a rebuild before submission. This includes selecting, replacing, or removing a Montage character-reference image.

**Why:** The server correctly rejected a reviewed plan after the client changed its reference image but retained the old fingerprint, producing an avoidable stale-prompts 422.

**How to apply:** When adding planner inputs, update both the preview request and the client invalidation dependencies. Do not weaken the server fingerprint check; stale reviewed prompts must remain unchargeable.