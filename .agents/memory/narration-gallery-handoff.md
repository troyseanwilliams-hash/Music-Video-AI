---
name: Narration gallery handoff
description: Persistence and naming contract when completed narration is saved or handed into video creation.
---

Completed narration must be saved to the user’s private My Music library before video setup opens. The user controls one editable narration title, and that title must be used for both the saved audio and the video handoff.

**Why:** Choosing “Use in Video” must not leave the source narration outside the user’s library, and an automatically derived script excerpt is not a reliable user-facing title.

**How to apply:** Treat the library save as a prerequisite for video handoff. Keep it owner-scoped and idempotent, stop the handoff if saving fails, and allow the same title to be edited again through My Music’s existing rename flow.