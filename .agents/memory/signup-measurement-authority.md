---
name: Signup measurement authority
description: Why account creation must be measured server-side and separately from activation.
---

Treat committed account creation as the authoritative signup outcome, not a browser success event. Keep signup outcomes deduplicated and reject client-written authoritative outcome names.

**Why:** Production account creations continued while browser analytics reported zero completed signups. Browser delivery alone cannot distinguish a broken form from untracked registrations.

**How to apply:** Preserve atomic account/outcome writes and opaque optional visitor attribution. Report first successful creation separately from signup, exclude preview-backfill jobs, and do not infer campaign uplift from unmatched pageview and account counts.