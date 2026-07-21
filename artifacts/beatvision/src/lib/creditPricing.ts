import type { CreateJobRequestRequestedDuration } from "@workspace/api-client-react";

export type AiProvider = "runway" | "luma";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  runway: "Runway Gen-4",
  luma: "Luma Dream Machine",
};

// Profit margin: price = 2× the underlying cost scale, so half of every
// charge is the site's profit — mirror creditCost.ts.
export const PRICE_MULTIPLIER = 2;

// Social export costs — mirror artifacts/api-server/src/lib/creditCost.ts.
export const TEASER_PACK_COST = 15 * PRICE_MULTIPLIER;
export const CANVAS_EXPORT_COST = 10 * PRICE_MULTIPLIER;
export const LYRIC_OVERLAY_COST = 10 * PRICE_MULTIPLIER;

// Mirror of artifacts/api-server/src/lib/creditCost.ts. Charge = real provider
// clip cost × tiered markup (2× single-clip / 1.5× multi-clip).
const MAX_CLIPS_PER_JOB = 3;
const RUNWAY_USD_PER_SECOND = 0.12;
const USD_PER_CREDIT = 0.015;
const SHORT_MARKUP = 2;
const LONG_MARKUP = 1.5;

function getClipPlan(requestedDuration: string | null | undefined): { numClips: number; clipDurationSec: 5 | 10 } {
  const dur = requestedDuration ?? "full";
  if (dur === "full") return { numClips: MAX_CLIPS_PER_JOB, clipDurationSec: 10 };
  const durSec = parseInt(dur, 10);
  if (isNaN(durSec) || durSec <= 0) return { numClips: MAX_CLIPS_PER_JOB, clipDurationSec: 10 };
  const clipDurationSec: 5 | 10 = durSec <= 5 ? 5 : 10;
  return { numClips: Math.max(1, Math.ceil(durSec / clipDurationSec)), clipDurationSec };
}

// Priced on real clip cost — resolution tiers carry no surcharge (mirror creditCost.ts).
export function estimateCreditCost(
  requestedDuration: CreateJobRequestRequestedDuration | null | undefined,
  _provider?: AiProvider,
  _resolution?: string | null,
): number {
  const { numClips, clipDurationSec } = getClipPlan((requestedDuration ?? "full") as string);
  const costCredits = (numClips * clipDurationSec * RUNWAY_USD_PER_SECOND) / USD_PER_CREDIT;
  const markup = numClips <= 1 ? SHORT_MARKUP : LONG_MARKUP;
  return Math.ceil(costCredits * markup);
}
