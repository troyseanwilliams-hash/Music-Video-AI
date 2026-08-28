---
name: Named-subject reference prompts
description: Product rule for handling named people and characters in Prompt Generation.
---

When Generate detects a named person or character without a reference image, preserve the user-facing warning exactly and offer the user three explicit choices: add a reference image, replace the name with a safe visual description, or continue without one.

The replacement choice uses the current script as context, generates a concise historically grounded visual description, replaces every occurrence of the detected name while preserving the script structure, and leaves the updated script for user review. Do not silently create or charge for a reference image. Existing uploaded and gallery-selected reference images remain supported.

**Why:** Named people and fictional characters may be rejected by image services, but users must retain control over whether to provide a reference image, rewrite the prompt safely, or accept that risk and submit without one.

**How to apply:** Keep the choice simple: let the user open the existing reference-image picker, request the server-side description rewrite, or continue into the normal confirmation flow without a reference.