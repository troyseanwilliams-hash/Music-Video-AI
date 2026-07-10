import type { CreateJobRequestRequestedDuration } from "@workspace/api-client-react";

export type AiProvider = "runway" | "kling" | "luma";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  runway: "Runway Gen-4",
  kling: "Kling",
  luma: "Luma Dream Machine",
};

const BASE_CREDITS = 20;
const CREDITS_PER_SECOND = 1;
const FULL_VIDEO_SECONDS = 120;

export function estimateCreditCost(
  requestedDuration: CreateJobRequestRequestedDuration | null | undefined,
  _provider?: AiProvider,
): number {
  const dur = (requestedDuration ?? "full") as string;
  let secs: number;
  if (dur === "full") {
    secs = FULL_VIDEO_SECONDS;
  } else {
    const n = parseInt(dur, 10);
    secs = isNaN(n) || n <= 0 ? FULL_VIDEO_SECONDS : Math.min(n, FULL_VIDEO_SECONDS);
  }
  return BASE_CREDITS + Math.ceil(secs * CREDITS_PER_SECOND);
}
