import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";

export type ImageReviewReplacementBillingScene = {
  source?: string;
  status?: string;
};

/**
 * A terminal failure of an original image generation consumes the image
 * reservation already made for that scene, so its recovery attempt is free.
 * Replacing a usable image is always a new generation and a new charge.
 */
export function imageReviewReplacementCredits(
  scene: ImageReviewReplacementBillingScene,
): number {
  return scene.source === "original_generation" && scene.status === "failed"
    ? 0
    : GENERATED_IMAGE_CREDITS_PER_VISUAL;
}