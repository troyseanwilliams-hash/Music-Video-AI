---
name: Montage commentary workflow
description: Product scope and safety constraints for podcast/commentary overlays in Montage Studio.
---

Montage Studio should support assembling commentary and podcast episodes inside AIBeatSync, with optional video overlays and text cards. Keep advanced controls optional so ordinary single-track editing remains simple. Longer Montage projects do not extend Generate Video's separate duration limits.

The user confirmed the overlay workflow works well and wants multiple video and static-image overlays, each with its own saved time slot used in the final render.

**Why:** Creators need supporting media at specific moments, not one overlay for the entire video.

**How to apply:** Keep the existing overlay workflow; treat static images as timed layers alongside clips, not additional main-timeline segments.

**Why:** The user approved this approach to the attached commentary-video punch list, specifically to avoid needing a separate editor.

**How to apply:** Preserve legacy projects and existing billing when extending Montage. Keep complete source clips visible by default, including embedded creator watermarks; rounding and borders are explicit choices, not default cropping.

Absolute layer timing must not silently shift when a main-track file is missing or corrupt. Layered exports should fail with guidance to restore the main timeline rather than dropping that file and moving the remaining content.

**Why:** A commentary clip or fact card at the wrong moment can materially change the meaning of a podcast episode.

**How to apply:** Preserve main-track timing through recovery and partial-render handling; do not apply the legacy single-track skip-bad-clips behavior to projects with timed layers.
