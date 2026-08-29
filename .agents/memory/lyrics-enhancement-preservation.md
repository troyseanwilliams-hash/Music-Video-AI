---
name: Lyrics enhancement preservation
description: Rules for keeping user-authored songs intact when applying automated lyric improvements.
---

Enhancing existing lyrics is a conservative editing operation, not a rewrite. Preserve the song's story, voice, hook, section order, repetitions, line structure, and most exact wording. Reject results that substantially alter structure or vocabulary.

Paid lyric writing and enhancement must be backed by a successful external model call. A local/template fallback is free, and a failed or rejected enhancement must restore the exact debited credit buckets.

**Why:** Broad songwriting instructions caused the enhancement model—and its failure fallback—to replace user-authored songs with materially different lyrics. Charging for a local fallback or an unusable rejected edit would not represent a paid provider-backed deliverable.

**How to apply:** Use dedicated low-creativity editing instructions, ignore requests to reshape length or invent sections during enhancement, compare the result with the draft, and refund when the provider fails or the accepted output is unchanged. Never silently convert a paid provider failure into a charged template response.