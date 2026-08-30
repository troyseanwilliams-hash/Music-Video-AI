import { describe, expect, it } from "vitest";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";
import { imageReviewReplacementCredits } from "./imageReviewBilling.js";

describe("image review replacement billing", () => {
  it("allows a free recovery for a failed original generation", () => {
    expect(imageReviewReplacementCredits({
      source: "original_generation",
      status: "failed",
    })).toBe(0);
  });

  it("charges a new generation when replacing a ready image", () => {
    expect(imageReviewReplacementCredits({
      source: "original_generation",
      status: "ready",
    })).toBe(GENERATED_IMAGE_CREDITS_PER_VISUAL);
    expect(imageReviewReplacementCredits({
      source: "regenerated",
      status: "ready",
    })).toBe(GENERATED_IMAGE_CREDITS_PER_VISUAL);
  });
});