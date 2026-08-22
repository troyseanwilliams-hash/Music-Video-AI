import {
  getGenerationClipPlan,
  type AiProvider,
  type GenerationMode,
  type GenerationClipPlan,
} from "@/lib/creditPricing";

export interface JobTimeEstimate {
  minimumSeconds: number;
  maximumSeconds: number;
  label: string;
  unitCount: number;
  unitLabel: "clips" | "items";
}

function roundedMinuteRange(minimumSeconds: number, maximumSeconds: number): {
  minimumSeconds: number;
  maximumSeconds: number;
  label: string;
} {
  const minimumMinutes = Math.max(1, Math.floor(minimumSeconds / 60));
  const maximumMinutes = Math.max(minimumMinutes + 1, Math.ceil(maximumSeconds / 60));
  return {
    minimumSeconds: minimumMinutes * 60,
    maximumSeconds: maximumMinutes * 60,
    label: `${minimumMinutes}–${maximumMinutes} min`,
  };
}

export function getGenerationTimeEstimate(
  requestedDuration: string | null | undefined,
  provider?: AiProvider | string | null,
  resolution?: string | null,
  songDurationSec?: number | null,
  generationMode: GenerationMode = "montage",
): JobTimeEstimate & { plan: GenerationClipPlan } {
  const plan = getGenerationClipPlan(requestedDuration, songDurationSec, generationMode);
  const providerFactor = provider === "kling" ? 1.15 : provider === "luma" ? 1.1 : 1;
  const resolutionFactor =
    resolution === "4k" || resolution === "2160p" ? 1.3 : resolution === "1080p" ? 1.08 : 1;

  // AI providers do not expose reliable completion ETAs. Use a deliberately
  // broad range based on the number of sequential clip requests plus analysis,
  // stitching, and upload overhead. This is a planning range, not a countdown.
  const minimumSeconds =
    (75 + plan.numClips * 50 + plan.targetDurationSec * 0.05) * providerFactor * resolutionFactor;
  const maximumSeconds =
    (150 + plan.numClips * 120 + plan.targetDurationSec * 0.15) * providerFactor * resolutionFactor;
  return {
    ...roundedMinuteRange(minimumSeconds, maximumSeconds),
    unitCount: plan.numClips,
    unitLabel: "clips",
    plan,
  };
}

export function getRemixTimeEstimate(input: {
  durationSeconds: number;
  segmentCount: number;
  resolution?: string | null;
  hasTransition?: boolean;
  hasKaraoke?: boolean;
}): JobTimeEstimate {
  const duration = Math.max(0, input.durationSeconds);
  const segments = Math.max(1, Math.round(input.segmentCount));
  const resolutionFactor = input.resolution === "1080p" ? 1.2 : 1;
  const transitionFactor = input.hasTransition ? 1.08 : 1;
  const karaokeFactor = input.hasKaraoke ? 1.15 : 1;
  const factor = resolutionFactor * transitionFactor * karaokeFactor;

  // Remix work is dominated by decoding/normalizing each source and encoding
  // the final timeline. Duration, item count, transitions, resolution, and
  // caption burning all contribute to the range.
  const minimumSeconds = Math.max(90, (45 + segments * 8 + duration * 0.3) * factor);
  const maximumSeconds = Math.max(180, (120 + segments * 20 + duration) * factor);
  return {
    ...roundedMinuteRange(minimumSeconds, maximumSeconds),
    unitCount: segments,
    unitLabel: "items",
  };
}

export function getRemainingEstimate(
  estimate: JobTimeEstimate,
  progressPercent: number,
): Pick<JobTimeEstimate, "minimumSeconds" | "maximumSeconds" | "label"> {
  const remainingFraction = Math.max(0.08, 1 - Math.max(0, Math.min(99, progressPercent)) / 100);
  const minimumSeconds = Math.max(60, estimate.minimumSeconds * remainingFraction);
  const maximumSeconds = Math.max(minimumSeconds + 60, estimate.maximumSeconds * remainingFraction);
  return roundedMinuteRange(minimumSeconds, maximumSeconds);
}