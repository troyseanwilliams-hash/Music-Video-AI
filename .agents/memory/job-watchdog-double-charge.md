---
name: Job watchdog double-charge guard
description: Stale-job recovery vs long 4K generations — heartbeat + claimed_at fencing prevent duplicate paid provider calls.
---

**Rule:** The stale-job watchdog (15-min `updated_at` threshold in api-server jobProcessor) must never re-queue a job that is still actively processing. Two guards exist and must be preserved in BOTH jobProcessor copies (api-server + worker):
1. Per-job heartbeat: poll loop starts `startJobHeartbeat(job.id)` on claim, bumps `updated_at` every 60s while status is analyzing/generating/stitching, stopped in `.finally()`.
2. Claim fencing: `assertJobOwned(job)` runs immediately before every `generateClip` provider call; compares live `claimed_at` against the row's claim-time value and aborts if the job was re-queued or re-claimed. `retryOrFail` short-circuits on the `OWNERSHIP_LOST` marker so the aborted run doesn't touch the job.

**Why:** A 4K Kling job (prod job hit this July 2026) legitimately went >15 min without progress updates; watchdog re-queued it while the first run was mid-generation, a second worker claimed it, and the provider API was called twice → double charges.

**Also:** The recovery UPDATE must genuinely increment `retry_count` and permanently fail jobs at the cap. The old `LEAST(retry_count + 1, MAX_RETRIES - 1)` clamp kept the counter below the limit forever, so a chronically stuck job (e.g. 4K ffmpeg stitch hanging >1h on the prod VM) was re-queued and re-billed roughly hourly until the user manually canceled. Recovery now re-queues only while `retry_count < MAX_RETRIES - 1` and hard-fails otherwise. Note: prod DB connections from the VM intermittently fail with "Authentication timed out" — heartbeats/watchdog writes can silently fail there, so never rely on a single write succeeding.

**July 2026 loop incident:** A full-song `editor_render` looped forever: heavy ffmpeg starved the DB pool so every single-shot heartbeat write failed for >15 min, the watchdog re-queued the live job, ownership fencing aborted the run, and the cycle repeated. Fixes now in place (preserve all three): heartbeats retry 3× 5s apart per tick (both jobProcessor copies); the api-server watchdog excludes its own in-flight job ids (`inFlightJobIds` set) from stale recovery; `editor_render` jobs use a 60-min stale threshold vs 15 min for others.

**How to apply:** Any new long-running step (new provider, longer poll loops, heavier stitching) must either update progress periodically or rely on the heartbeat — never remove the heartbeat or the fencing check. New provider call sites need an `assertJobOwned(job)` immediately before the paid call.
