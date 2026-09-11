---
name: Full-track runtime contract
description: Product rule for exact audio-length Full-track video creation.
---

Full-track videos require analysis of the currently selected uploaded audio. They support tracks up to 600 seconds; longer tracks must be clearly rejected before a paid job starts. The output runtime, provider-clip plan, credit calculation, audio/video stitch boundary, thumbnail timing, and saved video duration must use the same target duration.

**Why:** Users expect a Full-track render to finish with their music, and an unannounced cap can create a charged video that does not match the source track.

**How to apply:** When changing Full-track durations, pricing, audio analysis, or processing paths, retain the analysis gate and validate both worker and API-server execution routes against the same bounded duration.

The client must revalidate the current audio analysis when the final confirmation button is clicked, not only when opening the confirmation dialog.

**Why:** Audio selection or analysis state can become stale while a confirmation dialog is open, otherwise producing an avoidable server-side 422.

**How to apply:** Use one shared current-analysis predicate for preflight, confirmation-button disabling, and the submitted analysis payload; keep the API receipt check authoritative.

Every field returned by the analyzer must also exist in the OpenAPI `AudioAnalysis` schema before receipt verification parses the request.

**Why:** Generated Zod objects strip unknown fields. If signing includes a field the schema omits, parsing changes the payload and every otherwise-valid receipt fails verification.

**How to apply:** When the analyzer response shape changes, update OpenAPI and regenerate clients in the same change; regression-test the signed payload through `CreateJobBody` parsing.

For Full-track renders, an audio-range choice is a preferred Lip Sync segment, not an instruction to trim the main music video. Preserve that start time for the completed-video Lip Sync control, which may change its short clip length and range but must remain inside the finished video.

Montage timelines are additive even with transitions: transition overlap must not subtract from the user-selected timeline or soundtrack. Compensation must not replay moving footage/audio or accumulate a frozen ending. Allocate transition duration on an integer frame grid.

**Why:** Dissolves removed several seconds from completed montages. Independent rounding of fractional-frame transition/body durations can also silently remove the ending when the final output is capped.

**How to apply:** Test both total duration and recognizable final-frame preservation across many clips, including fractional-frame transitions. Derive video trims from the primary visual stream, not a container duration that may include longer audio.