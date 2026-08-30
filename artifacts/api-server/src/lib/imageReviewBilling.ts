import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";

export type ImageReviewReplacementBillingScene = {
  source?: string;
  status?: string;
};

export function imageReviewReplacementCredits(
  _scene: ImageReviewReplacementBillingScene,
): number {
  return GENERATED_IMAGE_CREDITS_PER_VISUAL;
}