---
name: Editor upload extension handling
description: The two-layer contract that keeps Studio editor video clips from silently vanishing during render.
---

# Editor upload extension contract

Studio editor renders can silently drop media segments when an uploaded object
has no file extension. The stitcher's "skip one bad segment" path then hides the
failure, so the symptom is "my videos didn't show up" with no error.

**The contract — two layers must agree, neither alone is sufficient:**

1. The presign route's MIME→ext map must cover every uploadable media type
   (audio, image, AND video). Anything missing is stored extension-less. Clients
   can also send an empty `contentType`, so this layer is best-effort, not a
   guarantee.
2. Server-side ext extraction must be slash-aware and fall back to a kind-based
   default when no real extension exists (video→mp4, photo→jpg, music→mp3). A
   naive `split(".").pop()` on an extension-less path returns the whole path
   (slashes included), which produces invalid temp filenames downstream.

**Why the fallback is safe:** ffmpeg detects the real container from file
content, so a generic `mp4` hint works even for mov/mkv inputs.

**How to apply:** `artifacts/api-server` and `artifacts/worker` each have their
own `jobProcessor.ts` — fix extraction in BOTH. Adding a new uploadable media
type means updating the presign MIME map too. Consider centralizing the MIME→ext
mapping to avoid client/server drift.
