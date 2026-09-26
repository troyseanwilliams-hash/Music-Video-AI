---
name: Suno import authority
description: Source authority and safety boundaries for imported Suno music.
---

New Suno-based renders must use the owned imported audio, not fetch the original external song again. Preserve bounded, allowlisted compatibility only for older jobs lacking an imported source.

**Why:** A successful import should not still depend on upstream link/CDN availability during rendering. Replacing a failed owned-object read with an external download can silently change the audio.

**How to apply:** Keep Suno redirects allowlisted at every hop, never use failed imports to clear an existing selection, and protect asynchronous imports from overwriting a newer music choice.