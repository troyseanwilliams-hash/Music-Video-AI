// Credit cost for a Studio (editor) render. Unlike AI generation, this is a
// CPU-only FFmpeg render with no AI-provider token cost, so it's priced cheaply.
// USD_PER_CREDIT mirrors creditCost.ts ($0.02/credit).

export interface EditorCostInput {
  durationSec: number;
  resolution?: string; // "720p" | "1080p"
  hasTransitions?: boolean;
}

// Free-tier limits (enforced in the route, surfaced in the UI).
export const EDITOR_FREE_MAX_SECONDS = 30;
export const EDITOR_FREE_RESOLUTION = "720p";

export function calculateEditorCost(input: EditorCostInput): number {
  const { durationSec, resolution = "720p", hasTransitions = false } = input;

  // Base cost by length tier.
  let credits = durationSec <= 60 ? 15 : durationSec <= 180 ? 40 : 75;

  // 1080p costs at least the mid tier.
  if (resolution === "1080p" && credits < 40) credits = 40;

  // Transitions re-encode the whole timeline (xfade), so add a small surcharge.
  if (hasTransitions) credits += 10;

  return credits;
}
