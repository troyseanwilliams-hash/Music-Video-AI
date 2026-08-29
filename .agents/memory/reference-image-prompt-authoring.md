---
name: Reference-image prompt authoring
description: Product rule for writing generated image prompts when a character reference image is attached.
---

When a character reference image is attached, generated image prompts should refer to the attached image for character identity and continuity instead of spending prompt space on a new character description.

**Why:** The image already supplies appearance, identity, wardrobe, and physical details. Re-describing them wastes the prompt budget and can conflict with the actual reference.

**How to apply:** Keep each generated image prompt concise. Decide reference relevance from the actual scene concept before prompt construction, never from generated planning labels such as “climax” or “hero subject.” Include the reference instruction only for character-focused scenes, and identify the attached image as the single canonical identity: preserve the same character without invention, substitution, or redesign. For environment-only and generic scenes, omit character directives entirely rather than adding negative text such as “no featured character.”