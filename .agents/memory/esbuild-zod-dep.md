---
name: esbuild zod dependency
description: Directly importing zod in api-server routes requires it as a declared dependency
---

If a new route in `artifacts/api-server/src/routes/` imports `from "zod"` or `from "zod/v4"`,
it will fail to build unless `"zod": "catalog:"` is listed in `artifacts/api-server/package.json`
dependencies — even though zod is in the workspace catalog.

**Why:** esbuild bundles from the package's own declared deps + hoisted workspace deps. Other routes
don't import zod directly (they consume pre-validated zod schemas from @workspace/db or @workspace/api-spec),
so the dep was missing. Also: `"zod/v4"` as an import path is NOT resolvable by esbuild even with
zod installed — always use `from "zod"` (the package is already v4).

**How to apply:** Before adding zod imports to api-server routes, ensure package.json has
`"zod": "catalog:"` and run `pnpm install --filter @workspace/api-server`.
