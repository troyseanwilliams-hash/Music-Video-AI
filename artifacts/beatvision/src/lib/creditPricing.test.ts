import { describe, expect, it } from "vitest";
import {
  estimateGeneratedImageCost,
  GENERATED_IMAGE_CREDITS_PER_VISUAL,
} from "./creditPricing";

describe("image-first video price estimates", () => {
  it("matches the server's automatic Montage image charge", () => {
    expect(estimateGeneratedImageCost("180", null, "montage", "video")).toBe(
      9 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
    expect(estimateGeneratedImageCost("180", null, "montage", "generated_images")).toBe(
      9 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
  });

  it("matches the server's one-image-per-scene Narrative charge", () => {
    expect(estimateGeneratedImageCost("180", null, "narrative", "video")).toBe(
      18 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
    expect(estimateGeneratedImageCost("full", 600, "narrative", "generated_images")).toBe(
      60 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
  });
});