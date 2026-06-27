// Credit cost for an AI generation. Priced by the requested video size — not by
// any AI-provider token math. A 5-second clip is the cheapest (about half the
// cost of a 30-second video) and a full video is the most expensive.
//
// Scale: cost = BASE_CREDITS + seconds × CREDITS_PER_SECOND
//   5s   → 25 credits   (minimum, ≈ ½ of 30s)
//   10s  → 30 credits
//   30s  → 50 credits
//   60s  → 80 credits
//   full → 140 credits  (max)
const MAX_CLIPS_PER_JOB = 3;

const BASE_CREDITS = 20; // floor so a 5s clip ≈ half a 30s clip
const CREDITS_PER_SECOND = 1; // linear scale on top of the floor
const FULL_VIDEO_SECONDS = 120; // "full" is billed as the maximum size

export function getClipPlan(requestedDuration: string | null | undefined): {
  numClips: number;
  clipDurationSec: 5 | 10;
} {
  const dur = requestedDuration ?? "full";
  if (dur === "full") {
    return { numClips: MAX_CLIPS_PER_JOB, clipDurationSec: 10 };
  }
  const durSec = parseInt(dur, 10);
  const clipDurationSec: 5 | 10 = durSec <= 5 ? 5 : 10;
  const numClips = Math.max(1, Math.ceil(durSec / clipDurationSec));
  return { numClips, clipDurationSec };
}

// Billable duration in seconds, resolved from the requested duration.
function billableSeconds(requestedDuration: string | null | undefined): number {
  const dur = requestedDuration ?? "full";
  if (dur === "full") return FULL_VIDEO_SECONDS;
  const n = parseInt(dur, 10);
  if (isNaN(n) || n <= 0) return FULL_VIDEO_SECONDS;
  return Math.min(n, FULL_VIDEO_SECONDS);
}

// Estimated == actual cost (the same function backs the pre-flight estimate
// shown to the customer and the deduction from their balance on success).
export function calculateCreditCost(requestedDuration: string | null | undefined): number {
  const secs = billableSeconds(requestedDuration);
  return BASE_CREDITS + Math.ceil(secs * CREDITS_PER_SECOND);
}
