---
name: Complete prompt shortening
description: Rule for fitting generated image prompts within character limits without exposing broken fragments.
---

Generated image prompts must never be clipped with an ellipsis or end on a partial word. Shorten at a whole-word boundary, remove dangling connector words, and close the shortened instruction with sentence punctuation.

**Why:** Character-limit clipping produced visible fragments such as `th…` and could remove scene-specific instructions when only the first complete sentence was retained.

**How to apply:** Put the supplied scene action and setting first so shortening cannot replace the story with aesthetic boilerplate. Reserve room for a brief style footnote at the end. Keep the longest whole-word prefix that fits, strip dangling connector words, and finish with punctuation. Apply this to Scene Builder output, storyboard prompts, and Creative Prompt handoffs.