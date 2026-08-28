---
name: Named-subject reference prompts
description: Product rule for handling named people and characters in Prompt Generation.
---

When Generate detects a named person or character without a reference image, preserve the user-facing warning exactly and ask the user whether to add a reference image or continue without one.

Do not silently create or charge for a reference image. Existing uploaded and gallery-selected reference images remain supported.

**Why:** Named people and fictional characters may be rejected by image services, but users must retain control over whether to provide a reference image or accept that risk and submit without one.

**How to apply:** Keep the choice simple: let the user open the existing reference-image picker, or continue into the normal confirmation flow without a reference.