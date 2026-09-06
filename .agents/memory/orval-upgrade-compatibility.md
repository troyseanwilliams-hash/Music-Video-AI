---
name: Orval upgrade compatibility
description: Compatibility constraints for upgrading the workspace OpenAPI generator without migrating application schemas to Zod 4.
---

Keep Orval pinned to a security-patched release that supports an explicit Zod 3 output target. Preserve deterministic cleanup of package barrel exports after generation.

**Why:** Patched Orval 8 releases otherwise fall back to Zod 4 syntax when they cannot infer the output package version, and newer generation also appends duplicate exports to existing workspace barrels. Both behaviors break an otherwise unchanged contract build.

**How to apply:** When updating Orval, run code generation twice, then run the full workspace typecheck. Confirm generated validators still use Zod 3 APIs and package index files remain duplicate-free.