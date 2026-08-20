---
name: Karaoke opt-in
description: Product rule for the paid lyric and karaoke overlay.
---

Karaoke/caption overlay must be off by default and must stay off when a user uploads, imports, or changes an audio source. It only becomes active after the user explicitly enables the captions control. Switching to a silent video must not clear an already explicit caption choice because on-screen text remains useful without audio.

**Why:** The user wants generation to avoid adding a paid lyric overlay unless they deliberately choose it.

**How to apply:** Do not auto-enable lyrics from audio-loading effects. Keep the existing explicit toggle and preserve its state unless the user changes it or the flow is intentionally reset.