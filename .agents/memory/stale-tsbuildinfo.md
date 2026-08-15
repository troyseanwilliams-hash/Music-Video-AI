---
name: Stale lib tsbuildinfo
description: Phantom "no exported member" / "property does not exist" TS errors from lib packages
---
Rule: when api-server/worker typecheck reports missing exports or missing columns that ARE present in `lib/*/src`, delete `lib/*/tsconfig.tsbuildinfo` and rerun `tsc --build` for the lib package before debugging anything else.

**Why:** lib packages (db, api-zod, ...) are composite TS projects with `emitDeclarationOnly`; their `.tsbuildinfo` caches go stale after schema/zod edits, producing phantom errors (e.g. `promoRedemptionsTable`, `analyticsEventsTable`, `lyrics`, `hasAudio`, enum literal mismatches).

**How to apply:** `rm -f lib/*/tsconfig.tsbuildinfo && pnpm --filter @workspace/db --filter @workspace/api-zod exec tsc --build`, then re-run the app typecheck.
