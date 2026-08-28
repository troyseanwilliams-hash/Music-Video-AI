---
name: Worker deployment cutover
description: Safety rule for moving render processing from the API to a dedicated worker.
---

Keep the API's embedded job processor enabled until an always-on production
worker has been provisioned, deployed, and verified healthy. Only then disable
the API processor to avoid duplicate capacity.

**Why:** A development worker workflow does not consume production jobs. Turning
off the published API processor before the production worker exists creates a
healthy-looking enqueue API whose jobs never run.

**How to apply:** During deployment changes, verify the worker's production
readiness endpoint and queue consumption first, then switch the API to
enqueue-only mode.