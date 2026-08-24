import type { CreateJobRequestRequestedDuration } from "@workspace/api-client-react";

export type AiProvider = "runway" | "kling" | "luma";
export type GenerationMode = "montage" | "narrative";

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
// Bundled Release Kit (teasers + Canvas) — ~20% off vs buying separately. Mirror creditCost.ts.
export const RELEASE_KIT_COST = TEASER_PACK_COST + CANVAS_EXPORT_COST - 10;
// Cost to generate lyrics in Prompt Studio (covers the LLM cost with margin).
export const LYRICS_BUILD_COST = 3;

// Lip Sync (OmniHuman) — premium per-second add-on. Mirror of
// artifacts/api-server/src/lib/creditCost.ts:
//   ceil(seconds × $0.16 × 1.5 / $0.015) = 16 credits/second (15s = 240, 30s = 480).
// Priced at the same 1.5× markup as the rest of the app — it's just an expensive
// model. Runs on an existing video's audio via POST /api/videos/:id/lipsync.
const LIPSYNC_USD_PER_SECOND = 0.16;
const LIPSYNC_MARKUP = 1.5;
export const LIPSYNC_MIN_SECONDS = 5;
export const LIPSYNC_MAX_SECONDS = 30;
export const LIPSYNC_DEFAULT_SECONDS = 15;
export const LIPSYNC_CREDITS_PER_SECOND = 16;
export function calculateLipsyncCost(seconds: number | null | undefined): number {
  const s = Math.min(Math.max(Math.round(seconds || LIPSYNC_DEFAULT_SECONDS), LIPSYNC_MIN_SECONDS), LIPSYNC_MAX_SECONDS);
  return Math.ceil((s * LIPSYNC_USD_PER_SECOND * LIPSYNC_MARKUP) / USD_PER_CREDIT);
}

// Lip Sync applied to an EXISTING finished video is priced from that video's
// own real (pre-markup) provider cost, not the credits already charged for
// it — same LIPSYNC_MARKUP (1.5×) as above, but computed from the source
// job's generation inputs (provider, clip plan, resolution) instead of the
// lipsync clip's own duration, so the panel always shows exactly what the
// server reserves/charges/refunds. Mirror of
// artifacts/api-server/src/lib/creditCost.ts:calculateLipsyncCostFromSourceVideo.
//   e.g. a 60s Runway video (6 clips × 10s × $0.14/s = $8.40 real cost) →
//   1.5× = $12.60 → 840 credits.
//
// Only meaningful for a source job with well-defined generation inputs
// (jobType "ai" or "remix"). For anything else (e.g. a Studio editor_render
// export, which stitches pre-existing clips via ffmpeg with no AI provider
// call of its own), fall back to calculateLipsyncCost(seconds) instead.
export function calculateLipsyncCostFromSourceVideo(
  requestedDuration: string | null | undefined,
  resolution?: string | null,
  songDurationSec?: number | null,
  provider?: AiProvider | string | null,
): number {
  const { numClips, clipDurationSec } = getGenerationClipPlan(requestedDuration, songDurationSec);
  const costCredits = (numClips * clipDurationSec * usdPerSecondFor(provider as AiProvider | undefined)) / USD_PER_CREDIT;
  return Math.ceil(costCredits * resolutionMultiplier(resolution) * LIPSYNC_MARKUP);
}

// Lyric alignment (AssemblyAI) — small fixed add-on at the standard margin.
// Mirror of artifacts/api-server/src/lib/creditCost.ts.
export const LYRIC_ALIGN_COST = 2;

// Mirror of artifacts/api-server/src/lib/creditCost.ts. Charge = real provider
// clip cost × tiered markup (2× single-clip / 1.5× multi-clip). Full videos are
// capped at 5 min and scale 3–10 clips with song length.
const RUNWAY_USD_PER_SECOND = 0.14; // Freeway: $1.40 per 10s clip
const KLING_USD_PER_SECOND = 0.07; // standard Kling via Pixazo
function usdPerSecondFor(provider?: AiProvider): number {
  return provider === "kling" ? KLING_USD_PER_SECOND : RUNWAY_USD_PER_SECOND;
}
const USD_PER_CREDIT = 0.015;
const SHORT_MARKUP = 2;
const LONG_MARKUP = 1.5;
const KLING_LONG_MARKUP = 1.75; // Kling multi-clip markup (Runway stays 1.5×)
export const MAX_FULL_SECONDS = 600;
export const GENERATED_IMAGE_USD_PER_VISUAL = 0.07;
export const GENERATED_IMAGE_MARKUP = 1.5;
export const GENERATED_IMAGE_CREDITS_PER_VISUAL = Math.ceil(
  (GENERATED_IMAGE_USD_PER_VISUAL * GENERATED_IMAGE_MARKUP) / USD_PER_CREDIT - 1e-9,
);

function fullClipCount(songDurationSec?: number | null): number {
  const secs = songDurationSec && songDurationSec > 0 ? songDurationSec : MAX_FULL_SECONDS;
  return Math.max(3, Math.min(20, Math.ceil(Math.min(secs, MAX_FULL_SECONDS) / 30)));
}

// Resolution surcharge — mirror artifacts/api-server/src/lib/creditCost.ts.
// 720p ×1, 1080p ×1.25 (~43% margin), 4K ×5.0 (O3 4K really costs ~$0.42/s ≈ 6×
// standard, so ×5.0 clears ~30% margin on multi-clip 4K, ~40% on short 4K).
export function resolutionMultiplier(resolution?: string | null): number {
  const r = (resolution ?? "").toLowerCase();
  if (r === "4k" || r === "2160p") return 5.0;
  if (r === "1080p") return 1.25;
  return 1;
}

export interface GenerationClipPlan {
  numClips: number;
  clipDurationSec: 5 | 10;
  targetDurationSec: number;
}

export function getGenerationClipPlan(
  requestedDuration: string | null | undefined,
  songDurationSec?: number | null,
  generationMode: GenerationMode = "montage",
): GenerationClipPlan {
  const dur = requestedDuration ?? "full";
  if (generationMode === "narrative") {
    const targetDurationSec = dur === "full"
      ? Math.min(
          songDurationSec && songDurationSec > 0 ? songDurationSec : MAX_FULL_SECONDS,
          MAX_FULL_SECONDS,
        )
      : Math.max(1, parseInt(dur, 10) || 10);
    const clipDurationSec: 5 | 10 = targetDurationSec <= 5 ? 5 : 10;
    return {
      numClips: Math.max(1, Math.ceil(targetDurationSec / clipDurationSec)),
      clipDurationSec,
      targetDurationSec,
    };
  }
  if (dur === "full") {
    const targetDurationSec = Math.min(
      songDurationSec && songDurationSec > 0 ? songDurationSec : MAX_FULL_SECONDS,
      MAX_FULL_SECONDS,
    );
    return { numClips: fullClipCount(songDurationSec), clipDurationSec: 10, targetDurationSec };
  }
  const durSec = parseInt(dur, 10);
  if (isNaN(durSec) || durSec <= 0) {
    const targetDurationSec = Math.min(
      songDurationSec && songDurationSec > 0 ? songDurationSec : MAX_FULL_SECONDS,
      MAX_FULL_SECONDS,
    );
    return { numClips: fullClipCount(songDurationSec), clipDurationSec: 10, targetDurationSec };
  }
  const clipDurationSec: 5 | 10 = durSec <= 5 ? 5 : 10;
  // Explicit >2min scale by length so 10 min ≈ 2× 5 min: ~1 clip/20s, cap 30
  // (5 min = 15 clips, 10 min = 30). Shorter durations keep 1 clip/10s.
  const numClips = durSec > 120 ? Math.min(30, Math.ceil(durSec / 20)) : Math.max(1, Math.ceil(durSec / clipDurationSec));
  return { numClips, clipDurationSec, targetDurationSec: durSec };
}

// Priced on real clip cost × tiered markup × resolution multiplier (mirror
// creditCost.ts). songDurationSec sizes "full" videos (clips scale with length,
// capped at 10 min).
export function estimateCreditCost(
  requestedDuration: CreateJobRequestRequestedDuration | null | undefined,
  provider?: AiProvider,
  resolution?: string | null,
  songDurationSec?: number | null,
  generationMode: GenerationMode = "montage",
): number {
  const { numClips, clipDurationSec } = getGenerationClipPlan(
    (requestedDuration ?? "full") as string,
    songDurationSec,
    generationMode,
  );
  const costCredits = (numClips * clipDurationSec * usdPerSecondFor(provider)) / USD_PER_CREDIT;
  const markup = numClips <= 1 ? SHORT_MARKUP : provider === "kling" ? KLING_LONG_MARKUP : LONG_MARKUP;
  return Math.ceil(costCredits * markup * resolutionMultiplier(resolution));
}

export function estimateGeneratedImageCost(
  requestedDuration: CreateJobRequestRequestedDuration | null | undefined,
  songDurationSec: number | null | undefined,
  generationMode: GenerationMode,
  _visualSource?: "video" | "generated_images",
): number {
  return getGenerationClipPlan(requestedDuration, songDurationSec, generationMode).numClips
    * GENERATED_IMAGE_CREDITS_PER_VISUAL;
}

// Shared affordability check — mirrors the inline logic used across submission
// flows (admins always pass; a null/unknown balance doesn't block since we
// haven't loaded it yet — the backend is still the source of truth).
export function canAffordCredits(cost: number, balance: number | null | undefined, isAdmin?: boolean): boolean {
  return !!isAdmin || balance == null || balance >= cost;
}
