// Credit cost for a Studio (editor) export. Aligned with the same size-based
// pricing model as AI generation (creditCost.ts): cost scales with the length
// of the finished video, from a 5-second clip up to the full-length maximum.
//
// Scale: cost = BASE_CREDITS + seconds × CREDITS_PER_SECOND  (seconds capped at MAX)
//   5s    → 25 credits   (minimum)
//   10s   → 30 credits
//   30s   → 50 credits
//   60s   → 80 credits
//   120s+ → 140 credits  (max)
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

// Billable duration in seconds, clamped to the maximum.
function billableSeconds(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(durationSec, MAX_BILLABLE_SECONDS);
}

// Estimated == actual cost (the same function backs the pre-flight estimate
// shown in the Editor and the deduction from the customer's balance on success).
export function calculateEditorCost(input: EditorCostInput): number {
  const secs = billableSeconds(input.durationSec);
  return BASE_CREDITS + Math.ceil(secs * CREDITS_PER_SECOND);
}
