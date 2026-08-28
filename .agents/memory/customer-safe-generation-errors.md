---
name: Customer-safe generation errors
description: Defines how internal generation failures become useful customer-facing guidance.
---

Failed jobs should expose a safe failure category and next action, while keeping provider request IDs, raw diagnostics, and recovery metadata private.

**Why:** Stripping all diagnostics and replacing them with a generic failure message leaves customers unable to correct content-checker rejections or understand whether credits were returned.

**How to apply:** Map raw failures at the customer API boundary. Distinguish safety rejection, source-image failure, timeout, and unknown failure; include truthful settlement guidance and a concrete retry action.