const MAX_CLIPS_PER_JOB = 3;

const RUNWAY_TOKENS_PER_5S = 165;
const RUNWAY_TOKENS_PER_10S = 330;
const RUNWAY_USD_PER_TOKEN = 0.01;
const MARKUP = 2;
const USD_PER_CREDIT = 0.02;

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

export function calculateCreditCost(requestedDuration: string | null | undefined): number {
  const { numClips, clipDurationSec } = getClipPlan(requestedDuration);
  const tokensPerClip = clipDurationSec === 5 ? RUNWAY_TOKENS_PER_5S : RUNWAY_TOKENS_PER_10S;
  const totalTokens = numClips * tokensPerClip;
  const chargeUSD = totalTokens * RUNWAY_USD_PER_TOKEN * MARKUP;
  return Math.ceil(chargeUSD / USD_PER_CREDIT);
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
