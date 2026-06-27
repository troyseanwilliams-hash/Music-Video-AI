---
name: Editor (Studio) render billing model
description: How Editor render credit charging is gated, and a known precheck integrity gap.
---

# Editor render billing

Editor (Studio) renders are billed via a **7-day free trial** model, NOT a watermark/free-tier model.

- New users: `subscriptionStatus="trial"` + `trialEndsAt=now+7d` (set in auth.ts on register).
- `studio.ts` computes `fullAccess = isAdmin || subscriptionStatus==="active" || trialActive`
  (trialActive = `trialEndsAt > now`), then `chargeCredits = !fullAccess` and writes it onto the job manifest.
  `watermark` is always false now (watermark model was removed; `EDITOR_FREE_*` exports in editorCost.ts are dead).
- Both jobProcessors deduct credits **only when `manifest.chargeCredits`** (on render success).

**Why:** the gate is `chargeCredits`, not `watermark`. If you reintroduce watermark logic or change
the trial/subscription check, keep studio.ts, both jobProcessors, and editor.tsx in lockstep — a mismatch
either charges trial/admin users or lets post-trial users render free.

**Known gap (follow-up, not yet fixed):** the studio.ts credit precheck uses client-supplied segment
`durationSec` (`totalDuration`), but stitching uses the real clip duration. A client can understate
durations to pass the precheck; deduction floors at 0 (`GREATEST(remaining-cost,0)`), so true cost can
exceed balance. Fix would require server-side duration probing or credit reservation at enqueue. This
predates the trial model (the old watermark model trusted client durations too).
