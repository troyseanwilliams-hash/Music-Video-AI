---
name: Named-subject reference prompts
description: Product rule for handling named people and characters in Prompt Generation.
---

When Generate detects a named person or character, the user may attach a reference image or continue with a safe visual description. Never send the raw name through the no-reference path.

The replacement choice uses the current script as context, generates a concise historically grounded visual description, replaces every occurrence of the detected name while preserving the script structure, and leaves the updated script for user review. The returned script must be validated again; clear stale replacement errors and invalidate any previous shot plan or approvals when the prompt changes. Do not silently create or charge for a reference image. Existing uploaded and gallery-selected reference images remain supported.

**Why:** Named people and fictional characters may be rejected by image services, but users must retain control over whether to provide a reference image, rewrite the prompt safely, or accept that risk and submit without one.

**How to apply:** Let the user open the reference-image picker or continue with a descriptive replacement that remains editable before approval. Enforce the same substitution server-side. With a reference, use the original script only to identify relevant scenes and replace the name with reference-neutral wording before preview, persistence, or generation.