---
name: Existing artifact imports
description: Safe replacement workflow for importing an external repository into an already-registered Replit artifact.
---

When replacing an existing artifact from an external repository, preserve the artifact directory and managed registration. If the directory must be recreated, remove the complete partial directory first and use the artifact bootstrap flow again; do not directly edit artifact.toml.

**Why:** Removing the registered artifact directory automatically removes its managed workflow, and direct manifest edits are rejected by the artifact service.

**How to apply:** Copy source files into the existing artifact, adapt package name and preview routing, and update artifact metadata through the validated temp-file replacement flow. Restart the exact managed workflow and verify the preview afterward.

For private GitHub repository writes, a connected GitHub account may successfully read while Replit's connector transport blocks write payloads at Cloudflare. Keep a repository-scoped personal access token in workspace Secrets as the non-interactive Git fallback; never place it in the remote URL or command output.

**Why:** Git Trees, Git blobs, and file-content writes were all blocked by the connector transport even though OAuth reads worked. A secure `GIT_ASKPASS` helper using the workspace secret completed the non-force push.

**How to apply:** First attempt the connected GitHub account. If writes fail at the transport rather than authentication, request or refresh a repository-scoped token through Secrets, push from a temporary clone, and verify that every changed path stays inside the intended artifact.