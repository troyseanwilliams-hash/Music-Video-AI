---
name: Lyrics-driven vocal duration
description: Product rule separating automatic vocal-song runtime from explicit instrumental duration controls.
---

Vocal song generation must not ask users to choose a minute length. The lyric amount and section structure drive the target, and the vocal provider decides the final arrangement runtime. Instrumental generation keeps its explicit duration and loop controls.

**Why:** Vocal providers build full-song arrangements from the supplied lyrics and may ignore requested duration values. Showing a minute selector falsely promises an exact runtime and conflicts with the intended lyrics-first workflow.

**How to apply:** Omit explicit duration from vocal-generation clients, infer a bounded target from lyrics only where a provider or metadata contract requires one, and do not remove or alter instrumental duration controls.