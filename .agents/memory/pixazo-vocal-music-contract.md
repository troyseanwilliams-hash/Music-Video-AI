---
name: Pixazo vocal music contract
description: Durable provider-version guidance for lyric-based vocal soundtrack generation.
---

Use Pixazo's current documented MiniMax Music 3 `text-to-music` contract for vocal soundtrack generation. Do not default back to the legacy Music 2.6 `generate` contract.

**Why:** Music 2.6 accepted requests but then failed internally after repeated provider attempts, while Music 3 completed the same lyric-based vocal request and returned valid MP3 audio.

**How to apply:** When changing soundtrack routing or payloads, preserve the current Music 3 fields for prompt, lyrics or lyric optimization, MP3 format, sample rate, and bitrate. Keep older models available only through an intentional override.