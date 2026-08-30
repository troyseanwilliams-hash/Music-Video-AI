---
name: Job manifest jsonb writes
description: Concurrency rules for jobs.manifest salvage state (partialClips, pendingRequests) and clip recovery via provider poll URLs
---

**Rule:** All writes to salvage keys in `jobs.manifest` (`partialClips`, `pendingRequests`) must be atomic path-level SQL (`jsonb_set` + `||` / `-` key removal), never readAiMeta→writeAiMeta full-row overwrites — admin attach-clips, retry scheduling, and worker salvage can write concurrently and last-writer-wins drops keys (risking double provider spend).

**Why:** Architect review (Aug 2026) flagged lost-update races when the attach-clips admin endpoint merged concurrently with worker read-modify-write.

**How to apply:** New manifest keys touched from multiple writers get their own atomic UPDATE helpers in both jobProcessor copies. `pendingRequests` (clip index → Pixazo poll URL) is written on submit, cleared on clip persist or when the request is dead; stranded clips are recovered for free via `checkPixazoRequest` before regenerating.

**Rule:** Cast interpolated scalar parameters passed to PostgreSQL polymorphic JSON constructors such as `jsonb_build_object`.

**Why:** PostgreSQL cannot always infer prepared numeric parameter types inside polymorphic JSON functions, causing the entire transactional approval update to fail even though TypeScript and unit tests pass.

**How to apply:** Use explicit casts such as `::integer` for credit and count parameters in JSON SQL expressions; keep the transaction atomic so a failed manifest update also rolls back its credit debit.
