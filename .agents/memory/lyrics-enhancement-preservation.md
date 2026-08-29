---
name: Lyrics enhancement preservation
description: Rules for keeping user-authored songs intact when applying automated lyric improvements.
---

Enhancing existing lyrics is a conservative editing operation, not a rewrite. Preserve the song's story, voice, hook, section order, repetitions, line structure, and most exact wording. Reject results that substantially alter structure or vocabulary.

**Why:** Broad songwriting instructions caused the enhancement model—and its failure fallback—to replace user-authored songs with materially different lyrics.

**How to apply:** Use dedicated low-creativity editing instructions, ignore requests to reshape length or invent sections during enhancement, compare the result with the draft, and return the original draft whenever the output diverges too far or generation fails.