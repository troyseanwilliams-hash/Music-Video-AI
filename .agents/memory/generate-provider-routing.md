---
name: Generate provider routing
description: Why standard video generation must not activate direct-provider experiments for admin accounts
---

Rule: Standard Generate jobs must use the same configured provider route for administrators and customers. Do not add account-role flags that silently send admin jobs through a separate direct-provider path; keep direct experiments in dedicated, explicitly selected tools.

**Why:** A temporary admin-only direct override bypassed the normal production route and fallback behavior. When that separate provider balance was depleted, ordinary Generate jobs failed immediately even though the configured production route remained available.

**How to apply:** Provider selection may vary by the engine the user chooses, but not by whether the user is an administrator. Any future direct-provider preview belongs behind its own endpoint and UI, with independent availability and billing checks.