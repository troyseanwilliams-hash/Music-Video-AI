---
name: Generate is narrative-only
description: Product boundary between the Generate flow, legacy montage jobs, image packs, and Montage Studio.
---

The customer-facing Generate flow has one video structure: cohesive narrative generation. Do not restore a Visual Montage selector or allow handoffs to switch Generate into montage mode.

**Why:** Visual assembly now belongs in the separate Montage Studio surface, while a structure chooser inside Generate duplicated that product and complicated the generation path.

**How to apply:** Submit new Generate jobs with the existing `narrative` enum. Keep montage enums, processors, and stored-job compatibility intact for historical jobs, image workflows, and Montage Studio; internal identifiers are not renamed.