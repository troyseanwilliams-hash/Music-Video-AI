---
name: Generated-media prompt safety
description: Safety contract for prompts that feed paid image and video generation.
---

Generated-media prompts must be safety-adjusted before users review them, again when approved prompts are accepted, and once more at final image or video submission. Reviewed image prompts should remain concise visual briefs rather than exposing production instructions.

**Why:** Provider safety checks can cancel innocent but ambiguous scenes, especially scenes combining minors with physical contact. A single early check is insufficient because prompts can be edited or enter through fallback and replacement paths.

**How to apply:** Use one deterministic, idempotent rewrite policy in both processor copies. Preserve creative intent while making minors supervised and non-contact, and soften adult intimate, graphic-violence, and self-harm language before paid requests. Generated wording uses “gender,” never the related biological-classification term. Lead image prompts with the visible moment; keep safety cues positive and short; omit clip numbering, music sections, transition rules, and long negative lists.