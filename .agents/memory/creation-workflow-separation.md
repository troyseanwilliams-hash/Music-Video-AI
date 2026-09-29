---
name: Creation workflow separation
description: Keep standalone image creation separate from video creation to reduce interface complexity.
---

Standalone image generation belongs in its own creation flow, not a mode mixed into Generate Video.

**Why:** The user explicitly requested this separation in response to feedback that the interface was clunky.

**How to apply:** Preserve cross-links and gallery handoffs, but do not reintroduce an image-only toggle in the video form. Image foundations and their approval remain part of video creation because they are steps toward the requested video, not a separate output type.

Keep the visible image-first experience: show scene images as they become available, allow review and replacement, then require explicit approval before animating video scenes.

**Why:** The user specifically liked watching the images generate and reviewing them before video generation; backend continuity alone does not meet that expectation.

**How to apply:** Preserve progressive image previews and the paused review stage when simplifying Generate or its job-status page.