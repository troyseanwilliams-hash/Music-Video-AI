---
name: Music-aware prompt handoff
description: Safety and continuity rules for carrying music-timed Prompt Builder plans into Generate.
---

Music-aware Prompt Builder plans may be labeled exact only when based on user-owned audio with a verified analysis receipt and a supported full-track duration. Lock structural scene edits on exact plans; text refinements may continue, but they invalidate the old planner fingerprint.

**Why:** Audio analysis receipts are short-lived and scene-plan fingerprints become stale after edits. Trusting either across navigation could mismatch approved prompts, timing, and paid render segments.

**How to apply:** Preserve refined prompts as a consecutively numbered script plus the selected audio path. Generate must re-analyze the audio and rebuild/revalidate the authoritative plan before approval or charging. Never silently replace the numbered edits.