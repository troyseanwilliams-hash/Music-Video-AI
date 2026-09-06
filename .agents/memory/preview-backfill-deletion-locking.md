---
name: Preview backfill deletion locking
description: Concurrency and billing rules for creating browser renditions of existing completed videos.
---

Generate old-video browser previews as durable, explicitly zero-charge jobs. Keep the master read-only, use a deterministic preview object path, and claim-fence completion.

Serve both master and preview MP4s through short-lived direct object-storage URLs with native byte-range support; do not proxy long preview streams through the API.

**Why:** Preview encoding can outlive an HTTP request or race manual deletion. A purge based on a stale video row can miss a newly attached preview and leave an orphaned object. API-proxied Range requests can also stutter even after bitrate reduction.

**How to apply:** Preview finalization and manual purge must lock and re-read the same video row before attaching or deleting assets. Hold that lock through deletion of the current complete asset list and row removal. Redirect MP4 playback to signed object-storage URLs.