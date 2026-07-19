import type { CreateJobRequestRequestedDuration } from "@workspace/api-client-react";

export type AiProvider = "runway" | "kling" | "luma";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  runway: "Runway Gen-4",
  kling: "Kling",
  luma: "Luma Dream Machine",
};

// Profit margin: price = 2× the underlying cost scale, so half of every
// charge is the site's profit — mirror creditCost.ts.
export const PRICE_MULTIPLIER = 2;

// Social export costs — mirror artifacts/api-server/src/lib/creditCost.ts.
export const TEASER_PACK_COST = 15 * PRICE_MULTIPLIER;
export const CANVAS_EXPORT_COST = 10 * PRICE_MULTIPLIER;
export const LYRIC_OVERLAY_COST = 10 * PRICE_MULTIPLIER;

const BASE_CREDITS = 20;
const CREDITS_PER_SECOND = 1;
const FULL_VIDEO_SECONDS = 120;

// 4K renders carry a 50% premium — mirror creditCost.ts.
export const FOURK_SURCHARGE = 1.5;

export function estimateCreditCost(
  requestedDuration: CreateJobRequestRequestedDuration | null | undefined,
  _provider?: AiProvider,
  resolution?: string | null,
): number {
  const dur = (requestedDuration ?? "full") as string;
  let secs: number;
  if (dur === "full") {
    secs = FULL_VIDEO_SECONDS;
  } else {
    const n = parseInt(dur, 10);
    secs = isNaN(n) || n <= 0 ? FULL_VIDEO_SECONDS : Math.min(n, FULL_VIDEO_SECONDS);
  }
  const base = (BASE_CREDITS + Math.ceil(secs * CREDITS_PER_SECOND)) * PRICE_MULTIPLIER;
  return resolution === "4k" ? Math.ceil(base * FOURK_SURCHARGE) : base;
}
