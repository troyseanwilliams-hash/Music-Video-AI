---
name: ffmpeg OOM in production stitching
description: Why editor/video stitching gets OOM-killed on the prod VM and the two mitigations that actually work.
---

# ffmpeg OOM in production stitching

Studio editor renders on the prod VM were OOM-killed (`ffmpeg killed by OS`, exit code null)
on long timelines despite existing mitigations (720p cap, ultrafast preset, global `-threads 2`).

**Two root causes:**

1. A global `-threads N` placed *before* `-i` does NOT cap the libx264 encoder — the crash
   log's x264 options dump showed `threads=6`. Encoder thread cap must be an **output option**
   (`-threads 2` after the codec args, before the output file) at every encode site.
2. A single N-input `xfade`/`acrossfade` filter_complex chain buffers frames from every input
   at once, so peak memory grows with segment count. Fix: join **pairwise** (two clips per
   ffmpeg run, accumulating) — peak memory stays flat; CPU/time tradeoff is acceptable for a
   background job.

**Gotcha:** pairwise intermediates must keep `-video_track_timescale 30000` (same as the
normalized segments) — xfade errors out on mismatched input video timebases
(`timebase (1/15360) do not match ... (1/30000)`).

3. Normalized scene clips must not be re-encoded merely to attach the soundtrack. Concatenate
   the normalized video streams and stream-copy video while muxing audio; reserve full-video
   encoding for filters that truly require decoded frames (captions/watermarks).

**Why:** a six-scene full-track render completed every paid provider call, then repeatedly hit
the fixed 12-minute deadline during an unnecessary final libx264 encode.

**How to apply:** any new ffmpeg encode path in editorStitcher/videoStitcher (both api-server
AND worker copies — keep in lockstep) needs the output-side `-threads 2`, and multi-input
filter graphs should be avoided in favor of pairwise/sequential processing. Duration-aware
timeouts are appropriate only for unavoidable full-video encodes.
