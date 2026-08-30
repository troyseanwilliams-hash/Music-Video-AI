---
name: Existing artifact imports
description: Safe replacement workflow for importing an external repository into an already-registered Replit artifact.
---

When replacing an existing artifact from an external repository, preserve the artifact directory and managed registration. If the directory must be recreated, remove the complete partial directory first and use the artifact bootstrap flow again; do not directly edit artifact.toml.

**Why:** Removing the registered artifact directory automatically removes its managed workflow, and direct manifest edits are rejected by the artifact service.

**How to apply:** Copy source files into the existing artifact, adapt package name and preview routing, and update artifact metadata through the validated temp-file replacement flow. Restart the exact managed workflow and verify the preview afterward.