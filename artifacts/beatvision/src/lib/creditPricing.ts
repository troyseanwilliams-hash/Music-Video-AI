import type { CreateJobRequestRequestedDuration } from "@workspace/api-client-react";

export type AiProvider = "runway" | "kling" | "luma";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  runway: "Runway Gen-4",
  kling: "Kling (via Pixazo)",
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
// clip cost × tiered markup (2× single-clip / 1.5× multi-clip). Full videos are
// capped at 5 min and scale 3–10 clips with song length.
const RUNWAY_USD_PER_SECOND = 0.12;
const KLING_USD_PER_SECOND = 0.07; // standard Kling via Pixazo
function usdPerSecondFor(provider?: AiProvider): number {
  return provider === "kling" ? KLING_USD_PER_SECOND : RUNWAY_USD_PER_SECOND;
}
const USD_PER_CREDIT = 0.015;
const SHORT_MARKUP = 2;
const LONG_MARKUP = 1.5;
const KLING_LONG_MARKUP = 1.75; // Kling multi-clip markup (Runway stays 1.5×)
const MAX_FULL_SECONDS = 600;

function fullClipCount(songDurationSec?: number | null): number {
  const secs = songDurationSec && songDurationSec > 0 ? songDurationSec : MAX_FULL_SECONDS;
  return Math.max(3, Math.min(20, Math.ceil(Math.min(secs, MAX_FULL_SECONDS) / 30)));
}

// Resolution surcharge — mirror artifacts/api-server/src/lib/creditCost.ts.
// 720p ×1, 1080p ×1.25, 4K ×3.5 (4K is a premium tier — ~3× the provider compute).
export function resolutionMultiplier(resolution?: string | null): number {
  const r = (resolution ?? "").toLowerCase();
  if (r === "4k" || r === "2160p") return 3.5;
  if (r === "1080p") return 1.25;
  return 1;
}

function getClipPlan(requestedDuration: string | null | undefined, songDurationSec?: number | null): { numClips: number; clipDurationSec: 5 | 10 } {
  const dur = requestedDuration ?? "full";
  if (dur === "full") return { numClips: fullClipCount(songDurationSec), clipDurationSec: 10 };
  const durSec = parseInt(dur, 10);
  if (isNaN(durSec) || durSec <= 0) return { numClips: fullClipCount(songDurationSec), clipDurationSec: 10 };
  const clipDurationSec: 5 | 10 = durSec <= 5 ? 5 : 10;
  return { numClips: Math.max(1, Math.ceil(durSec / clipDurationSec)), clipDurationSec };
}

// Priced on real clip cost × tiered markup × resolution multiplier (mirror
// creditCost.ts). songDurationSec sizes "full" videos (clips scale with length,
// capped at 10 min).
export function estimateCreditCost(
  requestedDuration: CreateJobRequestRequestedDuration | null | undefined,
  provider?: AiProvider,
  resolution?: string | null,
  songDurationSec?: number | null,
): number {
  const { numClips, clipDurationSec } = getClipPlan((requestedDuration ?? "full") as string, songDurationSec);
  const costCredits = (numClips * clipDurationSec * usdPerSecondFor(provider)) / USD_PER_CREDIT;
  const markup = numClips <= 1 ? SHORT_MARKUP : provider === "kling" ? KLING_LONG_MARKUP : LONG_MARKUP;
  return Math.ceil(costCredits * markup * resolutionMultiplier(resolution));
}
