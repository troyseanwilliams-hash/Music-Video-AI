---
name: Externalize heavy SDKs in api-server esbuild
description: Why twilio/stripe/resend/google-auth-library/openid-client are in esbuild externals and must stay in dependencies
---

Rule: heavy server SDKs (twilio, stripe, resend, google-auth-library, openid-client) are listed in api-server `build.mjs` esbuild `external` and must remain in `dependencies` (not devDependencies).

**Why:** bundling them bloated dist/index.mjs to 11.4MB and made publish builds slow/flaky; externalizing cut it to 2.5MB and build time 68s→20s. Externalized packages resolve at runtime from `artifacts/api-server/node_modules` (VM deploy runs `node artifacts/api-server/dist/index.mjs`, resolution walks up from the bundle's location — NOT the workspace root).

**How to apply:** when adding a new heavy SDK, add it to externals AND keep it in `dependencies`. Moving an externalized package to devDependencies fails at runtime in prod, not at build time. Verify with `cd artifacts/api-server/dist && node --input-type=module -e "await import('<pkg>')"`.

Also: prod bundle takes ~30s to serve first /api/healthz 200 — deployment startup health check tolerates this; don't panic at slow first response.
