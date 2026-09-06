---
name: Preview backfill deletion locking
description: Concurrency and billing rules for creating browser renditions of existing completed videos.
---

Generate old-video browser previews as durable, explicitly zero-charge jobs. Keep the master read-only, use a deterministic preview object path, and claim-fence completion.

**Why:** Preview encoding can outlive an HTTP request or race manual and retention-based deletion. A purge based on a stale video row can miss a newly attached preview and leave an orphaned object.

**How to apply:** Preview finalization, manual purge, and scheduled purge must lock and re-read the same video row before attaching or deleting assets. Hold that lock through deletion of the current complete asset list and row removal.