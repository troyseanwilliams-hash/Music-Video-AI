---
name: Lip Sync audio format contract
description: Provider input-format constraint for queued AI Lip Sync jobs.
---

AI Lip Sync must receive the selected audio range as an MP3 or WAV file; never send the intermediate M4A clip produced by a generic audio pipeline.

**Why:** The provider accepts the generation request and later rejects an M4A input. The app correctly avoids automatically retrying that ambiguous paid request, but the user receives no video until a new job is submitted.

**How to apply:** Keep the API server and worker clip-extraction implementations aligned, encode temporary Lip Sync segments as MP3, and preserve the original `.mp3` or `.wav` extension when storing the provider input.