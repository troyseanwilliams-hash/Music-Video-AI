// Credit cost for a Studio (editor) export. Aligned with the same size-based
// pricing model as AI generation (creditCost.ts): cost scales with the length
// of the finished video, from a 5-second clip up to the full-length maximum.
//
// Scale: cost = (BASE_CREDITS + seconds × CREDITS_PER_SECOND) × PRICE_MULTIPLIER
//   5s    → 50 credits   (minimum)
//   10s   → 60 credits
//   30s   → 100 credits
//   60s   → 160 credits
//   120s+ → 280 credits  (max)
//
// Editor exports only cost credits once the user's free trial ends and they
// have no active subscription (chargeCredits === true). USD_PER_CREDIT mirrors
// creditCost.ts ($0.02/credit).

export interface EditorCostInput {
  durationSec: number;
  resolution?: string; // kept for call-site compatibility; not priced separately
  hasTransitions?: boolean; // kept for call-site compatibility; not priced separately
}

const BASE_CREDITS = 20; // floor so a 5s export ≈ half a 30s export
const CREDITS_PER_SECOND = 1; // linear scale on top of the floor
const MAX_BILLABLE_SECONDS = 120; // "full length" is billed as the maximum size
const PRICE_MULTIPLIER = 2; // profit margin: price = 2× cost, so half of every charge is site profit (see creditCost.ts)

// Billable duration in seconds, clamped to the maximum.
function billableSeconds(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(durationSec, MAX_BILLABLE_SECONDS);
}

// Estimated == actual cost (the same function backs the pre-flight estimate
// shown in the Editor and the deduction from the customer's balance on success).
export function calculateEditorCost(input: EditorCostInput): number {
  const secs = billableSeconds(input.durationSec);
  return (BASE_CREDITS + Math.ceil(secs * CREDITS_PER_SECOND)) * PRICE_MULTIPLIER;
}

// ── Freemium Remix Lab pricing ───────────────────────────────────────────────
// The editor is pure ffmpeg (no AI provider cost), so it's a growth/retention
// hook rather than a cost-recovery product. Everyone gets a generous free
// monthly allotment; beyond it, a token flat fee (well under any paid editor).
// Subscribers, trial users, and admins are unlimited (handled in the route).
export const FREE_EDITOR_EXPORTS_PER_MONTH = 10;
export const EDITOR_OVERAGE_COST = 15; // ~$0.30 at $0.02/credit, flat per export

// ── Trial karaoke allowance ──────────────────────────────────────────────────
// Karaoke lyric burns carry real cost (extra ffmpeg render time, and users
// often pair them with paid AssemblyAI auto-sync), so the free 7-day trial
// includes a limited number of lyric-burn exports. Beyond the allowance, trial
// users pay the standard lyric add-on from their credit balance. Subscribers
// and admins are unaffected.
export const TRIAL_LYRIC_EXPORTS = 3;
