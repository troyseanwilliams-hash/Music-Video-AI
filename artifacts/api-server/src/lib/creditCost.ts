// Credit cost for an AI generation. Priced by the requested video size — not by
// any AI-provider token math. A 5-second clip is the cheapest (about half the
// cost of a 30-second video) and a full video is the most expensive.
//
// Scale: cost = (BASE_CREDITS + seconds × CREDITS_PER_SECOND) × PRICE_MULTIPLIER
//   5s   → 50 credits   (minimum, ≈ ½ of 30s)
//   10s  → 60 credits
//   30s  → 100 credits
//   60s  → 160 credits
//   full → 280 credits  (max)
const MAX_CLIPS_PER_JOB = 3;

const BASE_CREDITS = 20; // floor so a 5s clip ≈ half a 30s clip
const CREDITS_PER_SECOND = 1; // linear scale on top of the floor
const FULL_VIDEO_SECONDS = 120; // "full" is billed as the maximum size

// Profit margin: the user-facing price is always double the underlying cost
// scale (BASE + seconds), so charge − cost = cost — i.e. the second half of
// every charge is the site's profit (100% markup / 50% margin). Mirror any
// change here in artifacts/beatvision/src/lib/creditPricing.ts (and the local
// estimators in dashboard.tsx, job-status.tsx, editor.tsx) + editorCost.ts.
export const PRICE_MULTIPLIER = 2;

// The underlying (pre-markup) cost of a generation — what the render "costs"
// the site on the credit scale. profit = calculateCreditCost − this.
export function calculateBaseCost(requestedDuration: string | null | undefined): number {
  return calculateCreditCost(requestedDuration) / PRICE_MULTIPLIER;
}

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
  return (BASE_CREDITS + Math.ceil(secs * CREDITS_PER_SECOND)) * PRICE_MULTIPLIER;
}

// Cost to remix (regenerate) a subset of an existing video's clips. Charged
// proportionally to the number of clips regenerated — never the full job. We
// divide the original job's full cost across its clips and bill only for the
// ones being redone (minimum 1 credit when at least one clip is selected).
export function calculateRemixCost(
  requestedDuration: string | null | undefined,
  totalClips: number,
  regeneratedClips: number,
): number {
  const safeTotal = Math.max(1, totalClips);
  const safeRegen = Math.max(0, Math.min(regeneratedClips, safeTotal));
  if (safeRegen === 0) return 0;
  const perClip = calculateCreditCost(requestedDuration) / safeTotal;
  return Math.max(1, Math.ceil(perClip * safeRegen));
}

// Flat cost for a teaser pack (3 vertical TikTok/Shorts cuts of an existing
// video). Pure ffmpeg — no AI generation — so it's priced like a small render.
// Mirror in artifacts/beatvision/src/lib/creditPricing.ts.
export const TEASER_PACK_COST = 15 * PRICE_MULTIPLIER;

// Flat cost for a Spotify Canvas export (one 9:16 loop, 3–8s, cut from an
// existing video). Mirror in artifacts/beatvision/src/lib/creditPricing.ts.
export const CANVAS_EXPORT_COST = 10 * PRICE_MULTIPLIER;

// Flat cost to burn karaoke lyrics onto an existing finished video (pure
// ffmpeg re-encode). Mirror in artifacts/beatvision/src/lib/creditPricing.ts.
export const LYRIC_OVERLAY_COST = 10 * PRICE_MULTIPLIER;
