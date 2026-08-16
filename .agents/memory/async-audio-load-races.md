---
name: Async audio-load staleness guards
description: Music/audio selection state set by async uploads/imports needs staleness tokens or completions clobber newer selections.
---

# Async audio-load staleness guards

Any state that an async load (file upload, Suno/link import, resolve fetch) writes on completion must be guarded against the user swapping the selection while the load is in flight.

**Why:** Remix's Auto-sync went dead after users picked multiple music tracks: a stale upload/import completion overwrote the newer selection's state (or nulled it on failure), leaving `objectPath` unset and the sync button disabled. Generate had the sibling bug: an in-flight Suno import could cache its objectPath onto a *different* track resolved afterwards, silently aligning lyrics to the wrong audio.

**How to apply:** Every entry point that kicks off an async audio load takes a monotonic token (`ref.current = ++counter`) before the `await`, and every completion (success *and* error path) checks the token before writing state. Synchronous selections (e.g. picking from a library dialog) must bump the token too, so pending loads can't clobber them. Where no token exists, compare an identity captured at start (e.g. the audioUrl the import was started for) inside the state updater.
