---
name: Cross-deployment resource leases
description: Durable concurrency rules for paid providers, local media processing, and object storage.
---

Limit provider submissions, FFmpeg execution, and object-storage transfers as
separate resources using renewable database-backed leases. Provider leases cover
submission only, not long polling. Losing or failing to renew a lease must cancel
the in-flight operation, and lease waits must preserve the owning job claim.

**Why:** Complete-job worker counts do not control the real bottlenecks. A single
job can fan out to several paid services while local encoders and storage
transfers have different capacity limits. Process-local semaphores also fail when
multiple deployments overlap.

**How to apply:** Route every new paid provider submission and material media or
storage sink through the matching lease. Do not acquire storage while holding a
provider or FFmpeg lease; finish and release one resource before acquiring the
next. Keep polling outside submission leases.